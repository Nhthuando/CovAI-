import {parseJavaScriptCode} from './babelParser.service.js';
import _traverse from '@babel/traverse';
import {ServiceError} from '../utils/serviceError.js';
import path from 'node:path';
import crypto from 'node:crypto';
const traverse=_traverse.default || _traverse;
const atStartup=p=>{
    for(let fn=p.getFunctionParent();fn;fn=fn.getFunctionParent())if(fn.parentPath?.node.type!=='CallExpression' || fn.parentPath.node.callee!==fn.node)return false;
    return true;
};
const sdks=new Map([
    ['stripe',{label:'Stripe',positions:[0]}],['openai',{label:'OpenAI',fields:['apiKey'],implicit:'OPENAI_API_KEY'}],
    ['@anthropic-ai/sdk',{label:'Anthropic',fields:['apiKey'],implicit:'ANTHROPIC_API_KEY'}],
    ['@google/generative-ai',{label:'Gemini',positions:[0]}],['resend',{label:'Resend',positions:[0],implicit:'RESEND_API_KEY'}],
    ['twilio',{label:'Twilio',positions:[0,1]}],['@sendgrid/mail',{label:'SendGrid',method:'setApiKey',positions:[0]}],
]);
const envName=node=>node?.type==='MemberExpression' && node.object?.type==='MemberExpression' && node.object.object.name==='process' && node.object.property.name==='env' ? (node.computed?node.property.value:node.property.name):null;
const isEnvironment=node=>node?.type==='MemberExpression' && node.object.name==='process' && node.property.name==='env';
const resolveEnvReference=(node,scope,depth=0)=>{
    const direct=envName(node);if(direct)return direct;
    if(node?.type!=='Identifier'||depth>4)return null;
    const binding=scope.getBinding(node.name),declaration=binding?.path.node;
    if(declaration?.type!=='VariableDeclarator')return null;
    if(declaration.id.type==='Identifier')return resolveEnvReference(declaration.init,binding.path.scope,depth+1);
    if(declaration.id.type==='ObjectPattern' && isEnvironment(declaration.init)) {
        const property=declaration.id.properties.find(property=>property.value?.type==='Identifier' && property.value.name===node.name);
        return property?.key?.name || property?.key?.value || null;
    }
    return null;
};
export const managedEnvironmentNames = (files,config) => [
    ...(config?.database?['DATABASE_URL','DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','MONGO_URL','MONGO_URI','MONGODB_URI','MONGODB_URL','SQLITE_DB_PATH','DB_FILE','DB_PATH','SQLITE_PATH','SQLITE_FILE',...files.filter(file=>file.path.endsWith('.prisma')).flatMap(file=>[...file.content.matchAll(/\burl\s*=\s*env\("([A-Za-z_]\w*)"\)/g)].map(match=>match[1]))]:[]),
    ...(config?.services?.redis?['REDIS_URL','REDIS_HOST','REDIS_PORT']:[]),
];

export const buildAutomaticTestEnvironment = ({files=[],env={},resources={},port,backendUrl,frontendUrl}) => {
    const result={NODE_ENV:'development',...env,...resources};
    const names=new Set();
    for(const file of files) {
        const parsed=parseJavaScriptCode(file.content);if(!parsed.success)continue;
        traverse(parsed.ast,{MemberExpression({node}){const name=envName(node);if(name)names.add(name);},VariableDeclarator({node}){if(node.id.type==='ObjectPattern' && isEnvironment(node.init))for(const property of node.id.properties){const name=property.key?.name || property.key?.value;if(name)names.add(name);}}});
    }
    for(const name of names) {
        if((/^(?:JWT(?:_[A-Z]+)*|SESSION|COOKIE|AUTH|NEXTAUTH|ACCESS_TOKEN|REFRESH_TOKEN)_SECRET(?:_KEY)?$/.test(name) || ['SESSION_KEY','COOKIE_KEY'].includes(name)) && !result[name])result[name]=crypto.randomBytes(32).toString('hex');
        if(name==='ENCRYPTION_KEY' && !result[name])result[name]=crypto.randomBytes(32).toString('hex');
        if(/^(?:PORT|SERVER_PORT|HTTP_PORT|API_PORT)$/.test(name) && port)result[name]=String(port);
        if(/^(?:VITE_|REACT_APP_|NEXT_PUBLIC_|NUXT_PUBLIC_|PUBLIC_)?API_(?:BASE_)?URL$/.test(name) && backendUrl)result[name]=backendUrl;
        if(/^(?:CLIENT_URL|FRONTEND_URL|CORS_ORIGIN|APP_ORIGIN)$/.test(name) && frontendUrl)result[name]=frontendUrl;
        if(/^(?:MONGO|MONGODB)_(?:URI|URL|CONNECTION_STRING)$/.test(name) && resources.MONGODB_URI)result[name]=resources.MONGODB_URI;
    }
    if(port)result.PORT=String(port);
    if(backendUrl)Object.assign(result,{VITE_API_URL:backendUrl,VITE_API_BASE_URL:backendUrl,NEXT_PUBLIC_API_URL:backendUrl,REACT_APP_API_URL:backendUrl,NUXT_PUBLIC_API_BASE:backendUrl});
    return result;
};

const startupFiles = (files,scripts) => {
    const entry=(scripts?.start || scripts?.dev || '').match(/^\s*(?:node|nodemon|tsx|ts-node)\s+["']?([\w./-]+\.[cm]?[jt]s)["']?\s*$/)?.[1];
    // Complex/custom launchers are checked at actual startup, not guessed here.
    if(!entry)return [];
    const modules=new Map(files.map(file=>[file.path.replaceAll('\\','/'),file]));
    const visited=new Set();
    const walk=name=>{
        if(visited.has(name)||!modules.has(name))return;
        visited.add(name);
        const parsed=parseJavaScriptCode(modules.get(name).content);if(!parsed.success)return;
        const imports=[];
        traverse(parsed.ast,{
            ImportDeclaration({node}){imports.push(node.source.value);},
            CallExpression(p){if(atStartup(p) && p.node.callee.name==='require' && p.node.arguments[0]?.type==='StringLiteral')imports.push(p.node.arguments[0].value);},
        });
        for(const request of imports.filter(value=>value.startsWith('.'))) {
            const base=path.posix.normalize(path.posix.join(path.posix.dirname(name),request));
            const target=[base,...['.js','.cjs','.mjs','.ts','/index.js','/index.ts'].map(ext=>base+ext)].find(value=>modules.has(value));
            if(target)walk(target);
        }
    };
    walk(path.posix.normalize(entry));
    return [...visited].map(name=>modules.get(name));
};

// Only report mandatory SDK credentials passed directly to a module-level
// constructor. Arbitrary env reads, lazy handlers and optional values are not
// sufficient evidence that startup requires a variable.
export const requiredStartupEnvironment = files => {
    const required=[];
    for(const file of files) {
        const parsed=parseJavaScriptCode(file.content);if(!parsed.success)continue;
        const bindings=new Map();
        traverse(parsed.ast,{
            ImportDeclaration({node}) {if(sdks.has(node.source.value))for(const spec of node.specifiers)bindings.set(spec.local.name,sdks.get(node.source.value));},
            VariableDeclarator({node}) {
                if(node.id.type==='Identifier' && node.init?.type==='CallExpression' && node.init.callee.name==='require' && sdks.has(node.init.arguments[0]?.value))bindings.set(node.id.name,sdks.get(node.init.arguments[0].value));
            },
        });
        const inspect=p=>{
            if(!atStartup(p) || p.findParent(parent=>['IfStatement','ConditionalExpression','LogicalExpression','TryStatement'].includes(parent.node.type)))return;
            const callee=p.node.callee;
            const sdk=bindings.get(callee.name || callee.object?.name);if(!sdk)return;
            if(sdk.method && callee.property?.name!==sdk.method)return;
            if(!sdk.method && callee.type!=='Identifier')return;
            if(p.node.arguments[1]?.type==='ObjectExpression' && p.node.arguments[1].properties.some(property=>(property.key?.name || property.key?.value)==='authenticator'))return;
            const argumentsToCheck=sdk.fields ? (p.node.arguments[0]?.properties || []).filter(property=>sdk.fields.includes(property.key?.name || property.key?.value)).map(property=>property.value) : sdk.positions.map(index=>p.node.arguments[index]);
            if(sdk.implicit && !p.node.arguments.length)required.push({name:sdk.implicit,sourceFile:file.path,integration:sdk.label});
            for(const argument of argumentsToCheck) {
                const name=resolveEnvReference(argument,p.scope);
                if(typeof name==='string' && /^[A-Za-z_]\w*$/.test(name))required.push({name,sourceFile:file.path,integration:sdk.label});
            }
        };
        traverse(parsed.ast,{CallExpression:inspect,NewExpression:inspect,IfStatement(p){
            if(!atStartup(p) || p.node.test.type!=='UnaryExpression' || p.node.test.operator!=='!')return;
            const name=resolveEnvReference(p.node.test.argument,p.scope);if(!name)return;
            const statements=p.node.consequent.type==='BlockStatement'?p.node.consequent.body:[p.node.consequent];
            if(statements.some(node=>node.type==='ThrowStatement' || node.type==='ExpressionStatement' && node.expression.type==='CallExpression' && node.expression.callee.object?.name==='process' && node.expression.callee.property?.name==='exit'))required.push({name,sourceFile:file.path,integration:'Application environment'});
        }});
    }
    return required;
};

export const validateStartupEnvironment = ({files,env,directory,scripts,managedVariables=[]}) => {
    const missing=requiredStartupEnvironment(startupFiles(files,scripts)).filter(item=>!env[item.name]?.trim() && !managedVariables.includes(item.name));
    if(!missing.length)return;
    const envFile=(directory==='.'?'':directory+'/')+'.env.test';
    const failure=new ServiceError(`Full Stack requires test environment configuration: ${[...new Set(missing.map(item=>item.name))].join(', ')}. Set these variables in ${envFile} for the imported project, then retry. ${missing[0].integration} is initialized during backend startup (${missing[0].sourceFile}); CovAI cannot generate third-party credentials. Existing secrets are never sent to setup AI.`,422);
    failure.code='SYSTEM_TEST_ENVIRONMENT_REQUIRED';
    throw failure;
};
