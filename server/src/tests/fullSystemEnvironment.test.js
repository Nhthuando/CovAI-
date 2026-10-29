import {it,expect} from '@jest/globals';
import {validateStartupEnvironment,requiredStartupEnvironment,buildAutomaticTestEnvironment,managedEnvironmentNames} from '../services/fullSystemEnvironment.service.js';
const files=[{path:'index.js',content:`const express=require('express');const payments=require('./routes/payments');`},{path:'routes/payments.js',content:`const Stripe=require('stripe');const stripe=Stripe(process.env.STRIPE_SECRET_KEY);`}];
it('reports mandatory imported SDK credentials before starting a database or installing packages',()=>{
    expect(()=>validateStartupEnvironment({files,env:{},directory:'server',scripts:{start:'node index.js'}})).toThrow('Set these variables in server/.env.test');
    try{validateStartupEnvironment({files,env:{},directory:'server',scripts:{start:'node index.js'}});}catch(error){expect(error.code).toBe('SYSTEM_TEST_ENVIRONMENT_REQUIRED');}
});
it('accepts configured credentials without including values in diagnostics',()=>{
    expect(()=>validateStartupEnvironment({files,env:{STRIPE_SECRET_KEY:'test-secret-value'},directory:'server',scripts:{start:'node index.js'}})).not.toThrow();
});
it('does not require credentials from an unimported SDK module or a lazy handler',()=>{
    expect(()=>validateStartupEnvironment({files:[{path:'index.js',content:'const app=require("express")();'},files[1]],env:{},directory:'.',scripts:{start:'node index.js'}})).not.toThrow();
    expect(requiredStartupEnvironment([{path:'lazy.js',content:`import Stripe from 'stripe';export function pay(){return new Stripe(process.env.STRIPE_SECRET_KEY);}`}])).toEqual([]);
});
it('does not infer mandatory values from arbitrary env reads or a constructor fallback',()=>{
    expect(requiredStartupEnvironment([{path:'optional.js',content:`import Stripe from 'stripe';const stripe=new Stripe(process.env.STRIPE_SECRET_KEY || 'fallback');const region=process.env.REGION;`}])).toEqual([]);
});
it('defers unknown custom launchers to actual startup instead of guessing their dependency graph',()=>{
    expect(()=>validateStartupEnvironment({files,env:{},directory:'.',scripts:{start:'custom-launcher'}})).not.toThrow();
});
it('does not mark guarded SDK initialization or an explicit authenticator as mandatory API-key configuration',()=>{
    expect(requiredStartupEnvironment([{path:'optional.js',content:`import Stripe from 'stripe';if(process.env.STRIPE_SECRET_KEY){const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);}const stripe=new Stripe(process.env.KEY,{authenticator:customAuth});`}])).toEqual([]);
});
it('generates internal auth secrets and wires real owned URLs without inventing cloud credentials',()=>{
    const files=[{path:'index.js',content:'if(!process.env.JWT_SECRET)throw Error();console.log(process.env.STRIPE_SECRET_KEY,process.env.VITE_API_BASE_URL,process.env.CORS_ORIGIN);'}];
    const env=buildAutomaticTestEnvironment({files,env:{DATABASE_URL:'postgres://production'},resources:{DATABASE_URL:'postgres://owned'},backendUrl:'http://127.0.0.1:4501',frontendUrl:'http://127.0.0.1:4174'});
    expect(env.JWT_SECRET).toMatch(/^[a-f0-9]{64}$/);expect(env.DATABASE_URL).toBe('postgres://owned');
    expect(env.VITE_API_BASE_URL).toBe('http://127.0.0.1:4501');expect(env.CORS_ORIGIN).toBe('http://127.0.0.1:4174');expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(()=>validateStartupEnvironment({files,env,directory:'.',scripts:{start:'node index.js'}})).not.toThrow();
});
it('discovers mandatory external credentials across SDKs and explicit source guards',()=>{
    const names=requiredStartupEnvironment([{path:'index.js',content:`import OpenAI from 'openai';import Anthropic from '@anthropic-ai/sdk';import {Resend} from 'resend';new OpenAI({apiKey:process.env.MY_AI_KEY});new Anthropic();new Resend(process.env.MAIL_TOKEN);if(!process.env.PAYMENT_TOKEN)throw Error('missing');`}]).map(item=>item.name);
    expect(names).toEqual(expect.arrayContaining(['MY_AI_KEY','ANTHROPIC_API_KEY','MAIL_TOKEN','PAYMENT_TOKEN']));
});
it('recognizes immediately executed async startup checks while leaving lazy handlers alone',()=>{
    const entries=requiredStartupEnvironment([{path:'index.js',content:`(async()=>{if(!process.env.PAYMENT_TOKEN)throw Error();function optional(){if(!process.env.LAZY_TOKEN)throw Error();}})();`}]);
    expect(entries.map(item=>item.name)).toEqual(['PAYMENT_TOKEN']);
});
it('resolves credential aliases and destructured environment variables without requiring defaulted values',()=>{
    const files=[{path:'index.js',content:`import OpenAI from 'openai';const {JWT_SECRET,PRIVATE_AI_KEY:key,OPTIONAL='fallback'}=process.env;const alias=key;new OpenAI({apiKey:alias});if(!JWT_SECRET)throw Error();if(!OPTIONAL)throw Error();`}];
    expect(requiredStartupEnvironment(files).map(item=>item.name)).toEqual(expect.arrayContaining(['PRIVATE_AI_KEY','JWT_SECRET']));
    expect(requiredStartupEnvironment(files).map(item=>item.name)).not.toContain('OPTIONAL');
    expect(buildAutomaticTestEnvironment({files}).JWT_SECRET).toMatch(/^[a-f0-9]{64}$/);
});
it('defers known database/cache variables to resource preparation and preserves external requirements',()=>{
    const config={database:{engine:'mysql'},services:{redis:true}};
    expect(managedEnvironmentNames([],config)).toEqual(expect.arrayContaining(['DATABASE_URL','REDIS_URL']));
    const files=[{path:'index.js',content:'if(!process.env.DATABASE_URL)throw Error();if(!process.env.EXTERNAL_TOKEN)throw Error();'}];
    expect(()=>validateStartupEnvironment({files,env:{},directory:'.',scripts:{start:'node index.js'},managedVariables:managedEnvironmentNames([],config)})).toThrow('EXTERNAL_TOKEN');
});
