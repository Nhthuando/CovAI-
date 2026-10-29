import {describe,it,expect,jest} from '@jest/globals';
const generateContent=jest.fn().mockResolvedValue({response:{text:()=>'{"content":"test"}',candidates:[]}});
const getGenerativeModel=jest.fn(()=>({generateContent}));
const runGeminiRequest=jest.fn(async(request)=>request({signal:new AbortController().signal}));
await jest.unstable_mockModule('@google/generative-ai',()=>({GoogleGenerativeAI:class {getGenerativeModel(...args){return getGenerativeModel(...args);}}}));
await jest.unstable_mockModule('../services/geminiRequestPolicy.service.js',()=>({runGeminiRequest,isDailyQuotaError:()=>false}));
const previousKey=process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY='unit-test-key';
const {generateText}=await import('../services/gemini.service.js');
const {createAiJobBudget,withAiJobBudget}=await import('../services/aiJobBudget.service.js');
if(previousKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previousKey;
describe('Gemini generation configuration forwarding',()=>{
  it('counts retries at the network boundary and stops before exceeding a job budget',async()=>{
    const budget=createAiJobBudget({maxRequests:1});
    const count=generateContent.mock.calls.length;
    generateContent.mockRejectedValueOnce(Object.assign(new Error('temporary'),{status:503}));
    runGeminiRequest.mockImplementationOnce(async request=>{
      try {await request({signal:new AbortController().signal});} catch { /* simulated retry */ }
      return request({signal:new AbortController().signal});
    });
    await expect(withAiJobBudget(budget,()=>generateText('prompt'))).rejects.toMatchObject({code:'AI_JOB_BUDGET_EXCEEDED'});
    expect(generateContent.mock.calls.length-count).toBe(1);
    expect(budget.snapshot()).toMatchObject({requests:1,incomplete:true});
  });
  it('captures provider usage without forwarding budget data to Gemini generation config',async()=>{
    const budget=createAiJobBudget();
    generateContent.mockResolvedValueOnce({response:{text:()=> 'ok',usageMetadata:{promptTokenCount:20,candidatesTokenCount:5,totalTokenCount:35}}});
    await withAiJobBudget(budget,()=>generateText('prompt',null,{maxOutputTokens:100}));
    expect(budget.snapshot()).toMatchObject({requests:1,totalTokens:35,incomplete:false});
    expect(generateContent.mock.calls.at(-1)[0].generationConfig).toEqual({maxOutputTokens:100});
  });
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
    const pending=generateText('prompt','gemini-3.8-flash',null,{});
    if(status===429) await expect(pending).rejects.toMatchObject({statusCode:429,code:'AI_QUOTA_EXCEEDED',resetAt:null});
    else await expect(pending).rejects.toThrow('temporary provider error');
    expect(getGenerativeModel.mock.calls.length-calls).toBe(1);
    await generateText('prompt','gemini-3.8-flash',null,{});
    expect(getGenerativeModel.mock.calls.at(-1)[0].model).toBe('gemini-3.8-flash');
  });
  it.each(['gemini-3.5-flash-lite','gemini-2.5-flash','gemini-3.1-flash-lite','gemini-3.8-flash'])('uses the selected catalog model %s',async model=>{
    await generateText('prompt',model,null,{});
    expect(getGenerativeModel.mock.calls.at(-1)[0].model).toBe(model);
  });
});
