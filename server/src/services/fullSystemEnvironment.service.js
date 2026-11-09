import {parseJavaScriptCode} from './babelParser.service.js';
import _traverse from '@babel/traverse';
import {ServiceError} from '../utils/serviceError.js';
import path from 'node:path';
import crypto from 'node:crypto';
const traverse=_traverse.default || _traverse;
// The same bounded source objects are analyzed for references, automatic values,
// startup imports and SDK requirements. Parse once per object; do not retain
// source across requests or cache credentials.
const parsedFiles=new WeakMap();
const parseFile=file=>{
    let parsed=parsedFiles.get(file);
    if(!parsed){parsed=parseJavaScriptCode(file.content);parsedFiles.set(file,parsed);}
    return parsed;
};
const atStartup=p=>{
    for(let fn=p.getFunctionParent();fn;fn=fn.getFunctionParent())if(fn.parentPath?.node.type!=='CallExpression' || fn.parentPath.node.callee!==fn.node)return false;
    return true;
};
const sdks=new Map([
    ['stripe',{label:'Stripe',positions:[0]}],['openai',{label:'OpenAI',fields:['apiKey'],implicit:'OPENAI_API_KEY'}],
    ['@anthropic-ai/sdk',{label:'Anthropic',fields:['apiKey'],implicit:'ANTHROPIC_API_KEY'}],
    ['@google/generative-ai',{label:'Gemini',positions:[0]}],['@google/genai',{label:'Gemini',fields:['apiKey']}],['resend',{label:'Resend',positions:[0],implicit:'RESEND_API_KEY'}],
    ['twilio',{label:'Twilio',positions:[0,1]}],['@sendgrid/mail',{label:'SendGrid',method:'setApiKey',positions:[0]}],
]);
const isEnvironment=node=>node?.type==='MemberExpression' && node.property?.name==='env' && (node.object?.name==='process' || node.object?.type==='MetaProperty' && node.object.meta?.name==='import');
const envName=node=>node?.type==='MemberExpression' && isEnvironment(node.object) ? (node.computed?node.property.value:node.property.name):null;
export const referencedEnvironment = files => {
    const rows=new Map();
    const add=(name,sourceFile)=>{if(typeof name==='string' && /^[A-Za-z_]\w*$/.test(name))rows.set(`${sourceFile}:${name}`,{name,sourceFile});};
    for(const file of files){
        const parsed=parseFile(file);if(!parsed.success)continue;
        traverse(parsed.ast,{
            MemberExpression({node}){add(envName(node),file.path);},
            VariableDeclarator({node}){if(node.id.type==='ObjectPattern' && isEnvironment(node.init))for(const property of node.id.properties)add(property.key?.name||property.key?.value,file.path);}
        });
    }
    return [...rows.values()];
};
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
    'NODE_ENV','CI','AUT_URL','PLAYWRIGHT_BASE_URL','CYPRESS_BASE_URL',
    'PORT','SERVER_PORT','HTTP_PORT','API_PORT','BACKEND_PORT','APP_PORT','WEB_PORT','VITE_PORT','HOST','HOSTNAME',
    'VITE_API_URL','VITE_API_BASE_URL','VITE_BACKEND_URL','VITE_SERVER_URL','NEXT_PUBLIC_API_URL','NEXT_PUBLIC_API_BASE_URL','NEXT_PUBLIC_BACKEND_URL','NEXT_PUBLIC_SERVER_URL','REACT_APP_API_URL','REACT_APP_API_BASE_URL','REACT_APP_BACKEND_URL','REACT_APP_SERVER_URL','NUXT_PUBLIC_API_BASE','API_URL','API_BASE_URL','BACKEND_URL','SERVER_URL','CLIENT_URL','FRONTEND_URL','CORS_ORIGIN','APP_ORIGIN','APP_URL','BASE_URL','PUBLIC_URL','NEXTAUTH_URL','AUTH_URL','BETTER_AUTH_URL',
    ...(config?.database?[
        'DATABASE_URL','DB_URI','DB_URL','DB_CONNECTION_STRING','DB_HOST','DB_PORT','DB_USER','DB_USERNAME','DB_PASSWORD','DB_PASS','DB_PASSWD','DB_NAME','DB_DATABASE','DB_DIALECT','DB_CLIENT',
        'MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_USER_NAME','MYSQL_PASSWORD','MYSQL_PASS','MYSQL_ROOT_PASSWORD','MYSQL_DATABASE','MYSQL_DB','MYSQL_URL','MYSQL_URI',
        'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','POSTGRES_HOST','POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','POSTGRES_DATABASE','POSTGRES_URL','POSTGRES_URI','POSTGRESQL_URL','POSTGRESQL_URI',
        'TYPEORM_CONNECTION','TYPEORM_HOST','TYPEORM_PORT','TYPEORM_USERNAME','TYPEORM_PASSWORD','TYPEORM_DATABASE',
        'MONGO_URL','MONGO_URI','MONGODB_URI','MONGODB_URL','MONGO_CONNECTION_STRING','MONGODB_CONNECTION_STRING','MONGO_HOST','MONGO_PORT','MONGO_DB','MONGO_DATABASE','MONGODB_DB','MONGODB_DATABASE',
        'SQLITE_DB_PATH','DB_FILE','DB_PATH','SQLITE_PATH','SQLITE_FILE','DATABASE_PATH','DATABASE_FILE','STORAGE_PATH','DB_STORAGE',
        ...files.filter(file=>file.path.endsWith('.prisma')).flatMap(file=>[...file.content.matchAll(/\burl\s*=\s*env\("([A-Za-z_]\w*)"\)/g)].map(match=>match[1]))
    ]:[]),
    ...(config?.services?.redis?['REDIS_URL','REDIS_URI','REDIS_HOST','REDIS_PORT','CACHE_URL']:[]),
];

export const buildAutomaticTestEnvironment = ({files=[],env={},resources={},port,backendUrl,frontendUrl}) => {
    const result={NODE_ENV:'development',...env,...resources};
    const names=new Set();
    for(const file of files) {
        const parsed=parseFile(file);if(!parsed.success)continue;
        traverse(parsed.ast,{MemberExpression({node}){const name=envName(node);if(name)names.add(name);},VariableDeclarator({node}){if(node.id.type==='ObjectPattern' && isEnvironment(node.init))for(const property of node.id.properties){const name=property.key?.name || property.key?.value;if(name)names.add(name);}}});
    }
    for(const name of names) {
        if((/^(?:JWT(?:_[A-Z]+)*|TOKEN|SESSION|COOKIE|AUTH|NEXTAUTH|BETTER_AUTH|PASSPORT|CSRF|SIGNING|HMAC|ENCRYPTION|ACCESS_TOKEN|REFRESH_TOKEN)_SECRET(?:_KEY)?$/.test(name) || ['SECRET','SECRET_KEY','APP_SECRET','APP_KEY','JWT_KEY','JWT_PRIVATE_KEY','SESSION_KEY','COOKIE_KEY','ENCRYPTION_KEY','TOKEN_SECRET'].includes(name)) && !result[name])result[name]=crypto.randomBytes(32).toString('hex');
        if((name==='SALT_ROUNDS' || name==='BCRYPT_ROUNDS') && !result[name])result[name]='10';
        if(/^(?:PORT|SERVER_PORT|HTTP_PORT|API_PORT|BACKEND_PORT|APP_PORT|WEB_PORT|VITE_PORT)$/.test(name) && port)result[name]=String(port);
        if(/^(?:HOST|HOSTNAME|SERVER_HOST|BIND_HOST|LISTEN_HOST)$/.test(name) && !result[name])result[name]='127.0.0.1';
        if(/^(?:VITE_|REACT_APP_|NEXT_PUBLIC_|NUXT_PUBLIC_|PUBLIC_)?(?:API|BACKEND|SERVER)_(?:BASE_)?(?:URL|URI|ORIGIN|HOST|ENDPOINT)$/.test(name) && backendUrl)result[name]=backendUrl;
        if(/^(?:CLIENT_URL|FRONTEND_URL|CORS_ORIGIN|APP_ORIGIN|APP_URL|BASE_URL|PUBLIC_URL|NEXTAUTH_URL|AUTH_URL|BETTER_AUTH_URL)$/.test(name) && (frontendUrl || backendUrl))result[name]=frontendUrl || backendUrl;
        if(/^(?:MONGO|MONGODB)_(?:URI|URL|CONNECTION_STRING)$/.test(name) && resources.MONGODB_URI)result[name]=resources.MONGODB_URI;
    }
    if(port)result.PORT=String(port);
    if(backendUrl)Object.assign(result,{VITE_API_URL:backendUrl,VITE_API_BASE_URL:backendUrl,VITE_BACKEND_URL:backendUrl,NEXT_PUBLIC_API_URL:backendUrl,NEXT_PUBLIC_BACKEND_URL:backendUrl,REACT_APP_API_URL:backendUrl,REACT_APP_BACKEND_URL:backendUrl,NUXT_PUBLIC_API_BASE:backendUrl});
    return result;
};

export const startupEnvironmentFiles = (files,scripts,{preferStart=true}={}) => {
    const name=(preferStart?['start','dev','serve','preview']:['dev','serve','start','preview']).find(name=>typeof scripts?.[name]==='string');
    const entry=(scripts?.[name] || '').match(/^\s*(?:node|nodemon|tsx|ts-node)\s+["']?([\w./-]+\.[cm]?[jt]s)["']?\s*$/)?.[1];
    // Complex/custom launchers are checked at actual startup, not guessed here.
    if(!entry)return [];
    const modules=new Map(files.map(file=>[file.path.replaceAll('\\','/'),file]));
    const visited=new Set();
    const walk=name=>{
        if(visited.has(name)||!modules.has(name))return;
        visited.add(name);
        const parsed=parseFile(modules.get(name));if(!parsed.success)return;
        const imports=[];
        traverse(parsed.ast,{
            ImportDeclaration({node}){imports.push(node.source.value);},
            ExportNamedDeclaration({node}){if(node.source)imports.push(node.source.value);},
            ExportAllDeclaration({node}){imports.push(node.source.value);},
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
export const requiredStartupEnvironment = (files,{startupOnly=true}={}) => {
    const required=[];
    for(const file of files) {
        const parsed=parseFile(file);if(!parsed.success)continue;
        const bindings=new Map();
        traverse(parsed.ast,{
            ImportDeclaration({node}) {if(sdks.has(node.source.value))for(const spec of node.specifiers)bindings.set(spec.local.name,sdks.get(node.source.value));},
            VariableDeclarator({node}) {
                if(node.id.type==='Identifier' && node.init?.type==='CallExpression' && node.init.callee.name==='require' && sdks.has(node.init.arguments[0]?.value))bindings.set(node.id.name,sdks.get(node.init.arguments[0].value));
            },
        });
        const inspect=p=>{
            if(startupOnly && (!atStartup(p) || p.findParent(parent=>['IfStatement','ConditionalExpression','LogicalExpression','TryStatement'].includes(parent.node.type))))return;
            const callee=p.node.callee;
            const sdk=bindings.get(callee.name || callee.object?.name);if(!sdk)return;
            if(sdk.method && callee.property?.name!==sdk.method)return;
            if(!sdk.method && callee.type!=='Identifier')return;
            if(p.node.arguments[1]?.type==='ObjectExpression' && p.node.arguments[1].properties.some(property=>(property.key?.name || property.key?.value)==='authenticator'))return;
            const argumentsToCheck=sdk.fields ? (p.node.arguments[0]?.properties || []).filter(property=>sdk.fields.includes(property.key?.name || property.key?.value)).map(property=>property.value) : sdk.positions.map(index=>p.node.arguments[index]);
            if(sdk.implicit && (!p.node.arguments.length || sdk.fields && p.node.arguments[0]?.type==='ObjectExpression' && !p.node.arguments[0].properties.some(property=>sdk.fields.includes(property.key?.name || property.key?.value))))required.push({name:sdk.implicit,sourceFile:file.path,integration:sdk.label});
            for(const argument of argumentsToCheck) {
                const name=resolveEnvReference(argument,p.scope);
                if(typeof name==='string' && /^[A-Za-z_]\w*$/.test(name))required.push({name,sourceFile:file.path,integration:sdk.label});
            }
        };
        traverse(parsed.ast,{CallExpression:inspect,NewExpression:inspect,IfStatement(p){
            if((startupOnly && !atStartup(p)) || p.node.test.type!=='UnaryExpression' || p.node.test.operator!=='!')return;
            const name=resolveEnvReference(p.node.test.argument,p.scope);if(!name)return;
            const statements=p.node.consequent.type==='BlockStatement'?p.node.consequent.body:[p.node.consequent];
            if(statements.some(node=>node.type==='ThrowStatement' || node.type==='ExpressionStatement' && node.expression.type==='CallExpression' && node.expression.callee.object?.name==='process' && node.expression.callee.property?.name==='exit'))required.push({name,sourceFile:file.path,integration:'Application environment'});
        }});
    }
    return required;
};

export const validateStartupEnvironment = ({files,env,directory,scripts,managedVariables=[],preferStart=true}) => {
    const missing=requiredStartupEnvironment(startupEnvironmentFiles(files,scripts,{preferStart})).filter(item=>!env[item.name]?.trim() && !managedVariables.includes(item.name));
    if(!missing.length)return;
    const envFile=(directory==='.'?'':directory+'/')+'.env.test';
    const failure=new ServiceError(`Full Stack requires test environment configuration: ${[...new Set(missing.map(item=>item.name))].join(', ')}. Set these variables in ${envFile} for the imported project, then retry. ${missing[0].integration} is initialized during backend startup (${missing[0].sourceFile}); CovAI cannot generate third-party credentials. Existing secrets are never sent to setup AI.`,422);
    failure.code='SYSTEM_TEST_ENVIRONMENT_REQUIRED';
    failure.details={variables:missing.map(item=>({name:item.name,service:item.integration,sourceFile:item.sourceFile,envFile}))};
    throw failure;
};
