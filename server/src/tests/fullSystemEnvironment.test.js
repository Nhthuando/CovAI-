import { describe, test, expect, it } from '@jest/globals';
import {validateStartupEnvironment,requiredStartupEnvironment,buildAutomaticTestEnvironment,managedEnvironmentNames,environmentFeatureMap,hardcodedServiceCredentials,referencedEnvironment} from '../services/fullSystemEnvironment.service.js';
const files=[{path:'index.js',content:`const express=require('express');const payments=require('./routes/payments');`},{path:'routes/payments.js',content:`const Stripe=require('stripe');const stripe=Stripe(process.env.STRIPE_SECRET_KEY);`}];
describe('external service source evidence', () => {
    test('ignores stand-in SDK instances used only when the configured key is missing', () => {
        const entry = {path:'src/stripe.client.js', content:`const Stripe = require('stripe');
class Client { verify() { const sdk = this.sdk || new Stripe('sk_test_placeholder'); return sdk; } }
const other = configured ? configured : new Stripe('sk_test_fallback');`};
        expect(hardcodedServiceCredentials([entry])).toEqual([]);
    });

    test('does not report public Stripe publishable keys in frontend code', () => {
        const entry = {path:'client/src/Payment.jsx', content:`import { loadStripe } from '@stripe/stripe-js';
const stripePromise = loadStripe('pk_test_51Habc');`};
        expect(hardcodedServiceCredentials([entry])).toEqual([]);
    });

    test('ignores credentials written in the app test suites', () => {
        const entries = [
            {path:'backend/tests/unit/stripe.test.js', content:`const Stripe = require('stripe'); const s = new Stripe('sk_test_unit');`},
            {path:'src/pay.spec.ts', content:`import Stripe from 'stripe'; const s = new Stripe('sk_test_spec');`},
        ];
        expect(hardcodedServiceCredentials(entries)).toEqual([]);
    });

    test('reads environment names through process.env aliases', () => {
        const entry = {path:'src/config/env.js', content:`function loadConfig(env = process.env) { return { stripe: env.STRIPE_SECRET_KEY, mail: env['MAIL_HOST'] }; }
const vars = process.env; const port = vars.APP_PORT;
function unrelated(env) { return env.NOT_AN_ENV; }`};
        const names = new Set(referencedEnvironment([entry]).map(row => row.name));
        expect([...names]).toEqual(expect.arrayContaining(['STRIPE_SECRET_KEY', 'MAIL_HOST', 'APP_PORT']));
        expect(names.has('NOT_AN_ENV')).toBe(false);
    });

    test('maps a Stripe variable to a checkout route in the same file', () => {
        const entry = {path:'app.js', content:`import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
app.post('/create-checkout-session', () => stripe.checkout.sessions.create({}));`};
        expect(environmentFeatureMap([entry]).get('STRIPE_SECRET_KEY')).toEqual([
            {method:'POST',path:'/create-checkout-session',sourceFile:'app.js',line:3},
        ]);
    });

    test('maps Stripe routes one relative import hop away', () => {
        const entries = [
            {path:'config/stripe.js',content:"export const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);"},
            {path:'routes/pay.js',content:"import {stripe} from '../config/stripe'; router.route('/pay').post(() => stripe.pay());"},
            {path:'app.js',content:"require('./routes/pay'); app.get('/unrelated', handler);"},
        ];
        expect(environmentFeatureMap(entries).get('STRIPE_SECRET_KEY')).toEqual([
            {method:'POST',path:'/pay',sourceFile:'routes/pay.js',line:1},
        ]);
    });

    test('maps an environment reference inside a handler only to its route', () => {
        const entry = {path:'app.js', content:`const app = require('express')();
app.get('/health', (_req, res) => res.send('ok'));
app.post('/pay', (_req, res) => { const apiKey = process.env.PAYOS_API_KEY; res.sendStatus(apiKey ? 200 : 503); });`};
        expect(environmentFeatureMap([entry]).get('PAYOS_API_KEY')).toEqual([
            {method:'POST',path:'/pay',sourceFile:'app.js',line:3},
        ]);
    });

    test('maps a module-level credential only to routes using its initialized client', () => {
        const entry = {path:'app.js', content:`const payos = new PayOS(process.env.PAYOS_CLIENT_ID);
app.post('/checkout', async (req, res) => { await payos.createPaymentLink({}); });
app.get('/health', (_req, res) => res.send('ok'));`};
        expect(environmentFeatureMap([entry]).get('PAYOS_CLIENT_ID')).toEqual([
            {method:'POST',path:'/checkout',sourceFile:'app.js',line:2},
        ]);
    });

    test('does not map a listen port to routes in the same file', () => {
        const entry = {path:'app.js', content:`app.get('/health', (_req, res) => res.send('ok'));
app.listen(process.env.PORT);`};
        expect(environmentFeatureMap([entry]).has('PORT')).toBe(false);
    });

    test('maps an imported environment reference only to routes using the import binding', () => {
        const entries = [
            {path:'app.js', content:`import { createUrl } from './payment.js';
app.post('/vnpay', (req, res) => createUrl(req));
app.get('/health', (_req, res) => res.send('ok'));`},
            {path:'payment.js', content:'export function createUrl(req) { return process.env.VNP_TMN_CODE; }'},
        ];
        expect(environmentFeatureMap(entries).get('VNP_TMN_CODE')).toEqual([
            {method:'POST',path:'/vnpay',sourceFile:'app.js',line:2},
        ]);
    });

    test('reports hard-coded Stripe and OpenAI credential locations without literals', () => {
        const entry = {path:'app.js',content:`import OpenAI from 'openai';
const stripe = require('stripe')('YOUR_STRIPE_SECRET_KEY');
const ai = new OpenAI({apiKey:'example-key'});
app.post('/create-checkout-session', async (req, res) => {
    const session = await stripe.checkout.sessions.create({});
    res.json(session);
});
app.get('/health', (req, res) => res.send('ok'));
router.get('/other', (stripe) => stripe.get());`};
        expect(hardcodedServiceCredentials([entry])).toEqual([
            {serviceId:'stripe',label:'Stripe',sourceFile:'app.js',line:2,envName:'STRIPE_SECRET_KEY',
                features:[{method:'POST',path:'/create-checkout-session',sourceFile:'app.js',line:4}]},
            {serviceId:'openai',label:'OpenAI',sourceFile:'app.js',line:3,envName:'OPENAI_API_KEY',features:[]},
        ]);
    });
});
describe('chained SDK initialization', () => {
    test('requires the Stripe variable from a server entry file', () => {
        const entry = { path: 'app.js', content: "const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);" };
        expect(requiredStartupEnvironment([entry])).toEqual([
            { name: 'STRIPE_SECRET_KEY', sourceFile: 'app.js', integration: 'Stripe' },
        ]);
        expect(() => validateStartupEnvironment({
            files: [entry], env: {}, directory: '.', scripts: {}, entryFile: entry.path,
        })).toThrow('STRIPE_SECRET_KEY');
    });

    test('leaves literal Stripe keys out of required variables', () => {
        const entry = { path: 'app.js', content: "const stripe = require('stripe')('literal');" };
        expect(requiredStartupEnvironment([entry])).toEqual([]);
    });

    test('recognizes chained calls to a named SDK method', () => {
        const entry = { path: 'app.js', content: "require('@sendgrid/mail').setApiKey(process.env.SENDGRID_API_KEY);" };
        expect(requiredStartupEnvironment([entry])).toEqual([
            { name: 'SENDGRID_API_KEY', sourceFile: 'app.js', integration: 'SendGrid' },
        ]);
    });
});

it('reports mandatory imported SDK credentials before starting a database or installing packages',()=>{
    expect(()=>validateStartupEnvironment({files,env:{},directory:'server',scripts:{start:'node index.js'}})).toThrow('Add them in Test setup');
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
it('checks the script actually selected for unified frontend startup',()=>{
    const files=[{path:'dev.js',content:'if(!process.env.DEV_PROVIDER_TOKEN)throw Error();'},{path:'prod.js',content:'if(!process.env.PROD_PROVIDER_TOKEN)throw Error();'}];
    const options={files,env:{DEV_PROVIDER_TOKEN:'sandbox'},directory:'.',scripts:{start:'node prod.js',dev:'node dev.js'}};
    expect(()=>validateStartupEnvironment({...options,preferStart:false})).not.toThrow();
    expect(()=>validateStartupEnvironment({...options,preferStart:true})).toThrow('PROD_PROVIDER_TOKEN');
});
it('follows startup re-exports so a barrel module cannot hide a mandatory provider credential',()=>{
    const files=[{path:'index.js',content:"import './config.js';"},{path:'config.js',content:"export * from './provider.js';"},{path:'provider.js',content:"import OpenAI from 'openai';export const ai=new OpenAI();"}];
    expect(()=>validateStartupEnvironment({files,env:{},directory:'.',scripts:{start:'node index.js'}})).toThrow('OPENAI_API_KEY');
});
it('auto-provisions common DB, auth secret, and URL aliases without prompting the user',()=>{
    const config={database:{engine:'mysql'},services:{redis:true}};
    const managed=managedEnvironmentNames([],config);
    expect(managed).toEqual(expect.arrayContaining(['MYSQL_HOST','MYSQL_DATABASE','DB_PASS','DB_USERNAME','POSTGRES_DB','REDIS_URI']));
    const files=[{path:'index.js',content:'if(!process.env.TOKEN_SECRET)throw Error();if(!process.env.APP_SECRET)throw Error();if(!process.env.MYSQL_HOST)throw Error();console.log(process.env.VITE_BACKEND_URL,process.env.NEXTAUTH_URL);'}];
    const env=buildAutomaticTestEnvironment({files,backendUrl:'http://127.0.0.1:4501',frontendUrl:'http://127.0.0.1:4174'});
    expect(env.TOKEN_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(env.APP_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(env.VITE_BACKEND_URL).toBe('http://127.0.0.1:4501');
    expect(env.NEXTAUTH_URL).toBe('http://127.0.0.1:4174');
    expect(()=>validateStartupEnvironment({files,env,directory:'.',scripts:{start:'node index.js'},managedVariables:managed})).not.toThrow();
});
