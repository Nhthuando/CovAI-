import {parseJavaScriptCode} from './babelParser.service.js';
import _traverse from '@babel/traverse';
import {ServiceError} from '../utils/serviceError.js';
import {serviceForPackage} from './externalServiceCatalog.service.js';
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
const filePath = name => name.replaceAll('\\', '/');
const resolveRelativeModule = (modules, importer, request) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), request));
    return [base, ...['.js','.cjs','.mjs','.ts','.jsx','.tsx','/index.js','/index.ts'].map(ext => base + ext)]
        .find(candidate => modules.has(candidate));
};
const requireSpecifier = node => node?.type === 'CallExpression' && node.callee.name === 'require' &&
    node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined;

const routeMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const memberName = node => node.computed ? node.property.value : node.property.name;

const environmentReferenceVisitors = add => {
    const record = (name, location, target) => {
        if (typeof name === 'string' && /^[A-Za-z_]\w*$/.test(name)) add(name, location, target);
    };
    return {
        MemberExpression(p) { record(envName(p.node), p); },
        VariableDeclarator(p) {
            if (p.node.id.type !== 'ObjectPattern' || !isEnvironment(p.node.init)) return;
            for (const property of p.get('id.properties')) {
                const key = property.node.key;
                record(key?.name || key?.value, p.get('init'), property.get('value'));
            }
        },
    };
};

const variableTarget = p => {
    for (let current = p; current.parentPath; current = current.parentPath) {
        const parent = current.parentPath;
        if (parent.isFunction()) return undefined;
        if (current.key === 'init' && parent.isVariableDeclarator()) return parent.get('id');
        if (current.key === 'right' && parent.isAssignmentExpression()) return parent.get('left');
    }
};
const bindingKey = (scope, name) => scope.getBinding(name) ?? name;
const targetBindings = target => Object.keys(target?.getBindingIdentifiers() ?? {})
    .map(name => bindingKey(target.scope, name));

export const environmentFeatureMap = files => {
    const modules = new Map();
    const analyses = [];
    const features = new Map();
    for (const file of files) {
        const parsed = parseFile(file);
        if (!parsed.success) continue;
        const importer = filePath(file.path);
        const names = new Set();
        modules.set(importer, names);
        const routes = new Map();
        const imports = [];
        const environmentByBinding = new Map();
        const dependencies = new Map();
        const addBindingValue = (map, binding, value) => {
            if (!map.has(binding)) map.set(binding, new Set());
            map.get(binding).add(value);
        };
        const addImport = (request, bindings) => {
            if (request?.startsWith('.') && bindings.length) imports.push({request, bindings});
        };
        function* containingHandlers(p) {
            for (let parent = p.parentPath; parent; parent = parent.parentPath) {
                const route = routes.get(parent.node);
                if (route && p.node.start >= route.start && p.node.end <= route.end) yield route;
            }
        }
        traverse(parsed.ast, {
            ...environmentReferenceVisitors((name, location, target) => {
                names.add(name);
                const handler = containingHandlers(location).next().value;
                if (handler) handler.names.add(name);
                else if (!location.getFunctionParent()) {
                    for (const binding of targetBindings(target ?? variableTarget(location))) {
                        addBindingValue(environmentByBinding, binding, name);
                    }
                }
            }),
            ReferencedIdentifier(p) {
                const binding = bindingKey(p.scope, p.node.name);
                let inHandler = false;
                for (const handler of containingHandlers(p)) {
                    handler.identifiers.add(binding);
                    inHandler = true;
                }
                if (!inHandler && !p.getFunctionParent()) {
                    for (const target of targetBindings(variableTarget(p))) {
                        addBindingValue(dependencies, target, binding);
                    }
                }
            },
            ImportDeclaration(p) {
                addImport(p.node.source.value, p.get('specifiers').flatMap(targetBindings));
            },
            CallExpression(p) {
                const {node} = p;
                const request = requireSpecifier(node);
                if (request?.startsWith('.')) addImport(request, targetBindings(variableTarget(p)));
                const {callee} = node;
                if (callee.type !== 'MemberExpression') return;
                const method = memberName(callee);
                if (!routeMethods.has(method)) return;
                let routePath = node.arguments[0];
                let handlerStart = node.arguments[1];
                let receiver = callee.object;
                if (receiver.type === 'CallExpression' && receiver.callee.type === 'MemberExpression' && memberName(receiver.callee) === 'route') {
                    routePath = receiver.arguments[0];
                    handlerStart = node.arguments[0];
                    receiver = receiver.callee.object;
                }
                if (!handlerStart || receiver.type !== 'Identifier' || routePath?.type !== 'StringLiteral' ||
                    !(routePath.value.startsWith('/') || routePath.value === '*')) return;
                routes.set(node, {
                    start: handlerStart.start,
                    end: node.arguments.at(-1).end,
                    identifiers: new Set(),
                    names: new Set(),
                    feature: {method:method.toUpperCase(), path:routePath.value, sourceFile:file.path, line:node.loc.start.line},
                });
            },
        });
        if (routes.size) analyses.push({importer, routes, imports, environmentByBinding, dependencies});
    }
    for (const {importer, routes, imports, environmentByBinding, dependencies} of analyses) {
        const importsByBinding = new Map();
        for (const {request, bindings} of imports) {
            const target = resolveRelativeModule(modules, importer, request);
            if (!target) continue;
            for (const binding of bindings) importsByBinding.set(binding, modules.get(target));
        }
        for (const {identifiers, names, feature} of routes.values()) {
            for (const binding of identifiers) {
                for (const name of importsByBinding.get(binding) ?? []) names.add(name);
                for (const name of environmentByBinding.get(binding) ?? []) names.add(name);
                for (const dependency of dependencies.get(binding) ?? []) {
                    for (const name of environmentByBinding.get(dependency) ?? []) names.add(name);
                }
            }
            for (const name of names) {
                if (!features.has(name)) features.set(name, []);
                const entries = features.get(name);
                if (entries.length < 8 && !entries.some(entry => entry.method === feature.method && entry.path === feature.path &&
                    entry.sourceFile === feature.sourceFile && entry.line === feature.line)) entries.push(feature);
            }
        }
    }
    return features;
};

export const referencedEnvironment = files => {
    const rows=new Map();
    for(const file of files){
        const parsed=parseFile(file);if(!parsed.success)continue;
        const sourceFile = file.path;
        traverse(parsed.ast,environmentReferenceVisitors(name => rows.set(`${sourceFile}:${name}`, {name, sourceFile})));
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

export const startupEnvironmentFiles = (files,scripts,{preferStart=true,entryFile}={}) => {
    const name=(preferStart?['start','dev','serve','preview']:['dev','serve','start','preview']).find(name=>typeof scripts?.[name]==='string');
    const entry=name?scripts[name].match(/^\s*(?:node|nodemon|tsx|ts-node)\s+["']?([\w./-]+\.[cm]?[jt]s)["']?\s*$/)?.[1]:entryFile;
    // Complex/custom launchers are checked at actual startup, not guessed here.
    if(!entry)return [];
    const modules=new Map(files.map(file=>[filePath(file.path),file]));
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
            const target=resolveRelativeModule(modules,name,request);
            if(target)walk(target);
        }
    };
    walk(path.posix.normalize(entry));
    return [...visited].map(name=>modules.get(name));
};

const requiredSdk = node => sdks.get(requireSpecifier(node));

const sdkCredentialArguments = (node, sdk) => sdk.fields
    ? (node.arguments[0]?.properties || []).filter(property=>sdk.fields.includes(property.key?.name || property.key?.value)).map(property=>property.value)
    : sdk.positions.map(index=>node.arguments[index]);

const sdkPackageForBinding = (target, scope) => {
    if (target.type !== 'Identifier') return requireSpecifier(target);
    const binding = scope.getBinding(target.name)?.path;
    if (binding?.isImportSpecifier() || binding?.isImportDefaultSpecifier() || binding?.isImportNamespaceSpecifier()) {
        return binding.parentPath.node.source.value;
    }
    return binding?.isVariableDeclarator() ? requireSpecifier(binding.node.init) : undefined;
};

const positionalCredentialPackages = new Map([
    ['@stripe/stripe-js', 0], ['@supabase/supabase-js', 1], ['algoliasearch', 1], ['pusher-js', 0],
]);
const optionCredentialFields = ['apiKey', 'api_key', 'api_secret', 'authToken', 'clientSecret', 'dsn', 'secretAccessKey', 'accessToken', 'secret'];

export const hardcodedServiceCredentials = files => {
    const findings = new Map();
    for (const file of files) {
        const parsed = parseFile(file);
        if (!parsed.success) continue;
        const routes = [];
        const credentials = [];
        const inspect = call => {
            const {node, scope} = call;
            const {callee} = node;
            const member = callee.type === 'MemberExpression';
            const pkg = sdkPackageForBinding(member ? callee.object : callee, scope);
            const provider = pkg && serviceForPackage(pkg);
            if (!provider) return;
            const sdk = sdks.get(pkg);
            if (sdk?.method ? !member || memberName(callee) !== sdk.method : sdk && member) return;
            const position = positionalCredentialPackages.get(pkg);
            const args = sdk ? sdkCredentialArguments(node, sdk)
                : position !== undefined ? [node.arguments[position]]
                : sdkCredentialArguments(node, {fields:optionCredentialFields});
            if (!args.some(argument => argument?.type === 'StringLiteral')) return;
            const line = node.loc.start.line;
            const declaration = call.parentPath;
            const id = declaration.isVariableDeclarator() && declaration.node.init === node && declaration.node.id;
            const binding = id?.type === 'Identifier' ? scope.getBinding(id.name) : null;
            credentials.push({provider,line,binding});
        };
        traverse(parsed.ast, {
            CallExpression(call) {
                inspect(call);
                const {node} = call;
                const {callee} = node;
                if (callee.type !== 'MemberExpression' || !['app','router'].includes(callee.object.name)) return;
                const method = memberName(callee);
                const [routePath,...handlers] = call.get('arguments');
                if (!routeMethods.has(method) || !routePath?.isStringLiteral() || !handlers.length) return;
                const ranges = handlers.map(handler => {
                    if (!handler.isIdentifier()) return handler.node;
                    const declaration = handler.scope.getBinding(handler.node.name)?.path;
                    return declaration?.isVariableDeclarator() ? declaration.node.init : declaration?.node;
                }).filter(Boolean);
                routes.push({feature:{method:method.toUpperCase(),path:routePath.node.value,sourceFile:file.path,line:node.loc.start.line},ranges});
            },
            NewExpression:inspect,
        });
        for (const {provider,line,binding} of credentials) {
            const identity = `${provider.id}:${file.path}:${line}`;
            const finding = findings.get(identity) || {
                serviceId:provider.id, label:provider.label, sourceFile:file.path, line, envName:provider.primaryEnv, features:[],
            };
            for (const {feature,ranges} of routes) {
                if (binding?.referencePaths.some(({node}) => ranges.some(range => node.start >= range.start && node.end <= range.end)) &&
                    !finding.features.includes(feature)) finding.features.push(feature);
            }
            findings.set(identity,finding);
        }
    }
    return [...findings.values()];
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
                const sdk=requiredSdk(node.init);
                if(node.id.type==='Identifier' && sdk)bindings.set(node.id.name,sdk);
            },
        });
        const inspect=p=>{
            if(startupOnly && (!atStartup(p) || p.findParent(parent=>['IfStatement','ConditionalExpression','LogicalExpression','TryStatement'].includes(parent.node.type))))return;
            const callee=p.node.callee;
            const member=callee.type==='MemberExpression';
            const target=member?callee.object:callee;
            const sdk=bindings.get(target.name) || requiredSdk(target);if(!sdk)return;
            if(sdk.method ? !member || (callee.computed?callee.property.value:callee.property.name)!==sdk.method : member)return;
            if(p.node.arguments[1]?.type==='ObjectExpression' && p.node.arguments[1].properties.some(property=>(property.key?.name || property.key?.value)==='authenticator'))return;
            const argumentsToCheck=sdkCredentialArguments(p.node,sdk);
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

export const validateStartupEnvironment = ({files,env,directory,scripts,entryFile,managedVariables=[],preferStart=true}) => {
    const missing=requiredStartupEnvironment(startupEnvironmentFiles(files,scripts,{preferStart,entryFile})).filter(item=>!env[item.name]?.trim() && !managedVariables.includes(item.name));
    if(!missing.length)return;
    const envFile=(directory==='.'?'':directory+'/')+'.env.test';
    const failure=new ServiceError(`Full Stack requires test environment configuration: ${[...new Set(missing.map(item=>item.name))].join(', ')}. Add them in Test setup (System Test → setup status), then retry. ${missing[0].integration} is initialized during backend startup (${missing[0].sourceFile}); CovAI cannot generate third-party credentials. Existing secrets are never sent to setup AI.`,422);
    failure.code='SYSTEM_TEST_ENVIRONMENT_REQUIRED';
    failure.details={variables:missing.map(item=>({name:item.name,service:item.integration,sourceFile:item.sourceFile,envFile}))};
    throw failure;
};
