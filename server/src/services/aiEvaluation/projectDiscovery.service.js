import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseJavaScript } from '@babel/parser';
import { hash, fail } from './common.js';
import { projectAdapterOptions, projectAdapterCatalog } from './projectAdapterRegistry.service.js';
import { assessProjectEnvironment } from './projectEnvironment.service.js';

const ignored = new Set(['node_modules', '.git', '.agents', '.codex', '.next', '.nuxt', 'dist', 'build', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.covai-temp', 'test-results']);
const sourceExtension = /\.(?:[cm]?[jt]sx?|py)$/i;
const chatSignal = /chat|conversation|assistant|completion|generate|ask|message/i;
const providerSignal = /(?:openai|@google\/generative-ai|@google\/genai|@anthropic-ai|@ai-sdk\/|(?:^|['"])ai(?:['"]|$)|langchain|langgraph|ollama|groq|google\.generativeai|google\.genai|transformers|vllm|llama_cpp)/i;
const literal = node => node?.type === 'StringLiteral' ? node.value : undefined;
function transportHints(text) {
    const protocolHints = [];
    if (/text\/event-stream|StreamingResponse|EventSourceResponse|toUIMessageStreamResponse|toDataStreamResponse/.test(text)) protocolHints.push('HTTP_SSE');
    if (/application\/(?:x-)?ndjson/.test(text)) protocolHints.push('HTTP_NDJSON');
    return { protocolHints, requestShape: /convertToModelMessages/.test(text) ? 'AI_SDK_UI_MESSAGES' : 'CHAT_MESSAGES' };
}
function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node);
    for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) {
        if (Array.isArray(value)) value.forEach(child => walk(child, visit)); else if (value && typeof value === 'object') walk(value, visit);
    }
}
function inspectJavaScript(file, text) {
    let ast;
    try { ast = parseJavaScript(text, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators-legacy'], errorRecovery: true }); }
    catch { return { routes: [], environment: [], imports: [], parseError: true }; }
    const routes = [], environment = new Set(), imports = [], importBindings = [], portHints = [], socketEvents = [];
    walk(ast, node => {
        if (node.type === 'ImportDeclaration' && literal(node.source)) { imports.push(literal(node.source)); for (const item of node.specifiers) importBindings.push({ local: item.local.name, source: literal(node.source) }); }
        if (node.type === 'CallExpression' && node.callee?.name === 'require' && literal(node.arguments?.[0])) imports.push(literal(node.arguments[0]));
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.callee?.name === 'require' && literal(node.init.arguments?.[0])) importBindings.push({ local: node.id.name, source: literal(node.init.arguments[0]) });
        if (node.type === 'CallExpression' && node.callee?.property?.name === 'listen') walk(node.arguments?.[0], child => { if (child.type === 'NumericLiteral' && child.value >= 1 && child.value <= 65535) portHints.push(child.value); });
        if (node.type === 'CallExpression' && ['on', 'emit'].includes(node.callee?.property?.name) && literal(node.arguments?.[0])) socketEvents.push({ method: node.callee.property.name, event: literal(node.arguments[0]), line: node.loc.start.line });
        if (node.type === 'MemberExpression' && node.object?.type === 'MemberExpression' && node.object.object?.name === 'process' && node.object.property?.name === 'env') {
            const name = node.computed ? literal(node.property) : node.property?.name;
            if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) environment.add(name);
        }
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && ['post', 'all'].includes(node.callee.property?.name)) {
            const endpoint = literal(node.arguments?.[0]);
            if (!endpoint?.startsWith('/') || (!chatSignal.test(endpoint) && !providerSignal.test(text))) return;
            const fields = new Set(), outputs = new Set();
            walk(ast, child => {
                if (child.type === 'VariableDeclarator' && child.id?.type === 'ObjectPattern' && child.init?.type === 'MemberExpression' && child.init.property?.name === 'body') for (const prop of child.id.properties) if (prop.key?.name) fields.add(prop.key.name);
                if (child.type === 'MemberExpression' && child.object?.type === 'MemberExpression' && child.object.property?.name === 'body' && child.property?.name) fields.add(child.property.name);
                if (child.type === 'CallExpression' && ['json', 'send'].includes(child.callee?.property?.name) && child.arguments?.[0]?.type === 'ObjectExpression') for (const prop of child.arguments[0].properties) if (prop.key?.name) outputs.add(prop.key.name);
            });
            routes.push({ file, line: node.loc.start.line, method: 'POST', path: endpoint, receiver: node.callee.object?.name || null, inputFields: [...fields], outputFields: [...outputs], framework: 'NODE_HTTP', mountResolved: false });
        }
    });
    const next = file.match(/(?:^|\/)(?:src\/)?app\/(.+)\/route\.[jt]sx?$/);
    const pages = file.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+)\.[jt]sx?$/);
    if ((next && /export\s+(?:async\s+)?function\s+POST\b|export\s+const\s+POST\b/.test(text)) || pages) {
        const endpoint = '/' + (next ? next[1] : 'api/' + pages[1].replace(/\/index$/, ''));
        const inputFields = new Set();
        walk(ast, node => {
            if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern' && node.init?.type === 'AwaitExpression' && node.init.argument?.callee?.property?.name === 'json') for (const prop of node.id.properties) if (prop.key?.name) inputFields.add(prop.key.name);
        });
        if (chatSignal.test(endpoint) || providerSignal.test(text)) routes.push({ file, line: 1, method: 'POST', path: endpoint, framework: 'NEXT', inputFields: [...inputFields], outputFields: [], mountResolved: !endpoint.includes('[') });
    }
    const mounts = [];
    for (const route of routes) Object.assign(route, transportHints(text));
    walk(ast, node => {
        if (node.type === 'CallExpression' && node.callee?.property?.name === 'use' && typeof literal(node.arguments?.[0]) === 'string') mounts.push({ prefix: literal(node.arguments[0]), router: node.arguments[1]?.name, receiver: node.callee.object?.name });
    });
    return { routes, environment: [...environment], imports, importBindings, mounts, portHints, socketEvents, parseError: false };
}

/** Read-only, bounded analysis. Never imports project modules or executes package scripts. */
export async function discoverProjectChatbot(root, { maxFiles = 2500, maxBytes = 12 * 1024 * 1024 } = {}) {
    const realRoot = await fs.realpath(root);
    const files = [], packages = [], pythonPackages = [], routes = [], environment = new Set(), sources = [], warnings = [], manifests = [], modules = [], chainlitFiles = [], chainlitCallbacks = [], mountedChainlit = new Set();
    let count = 0, bytes = 0;
    async function visit(directory, depth) {
        if (depth > 12) { warnings.push('DEPTH_LIMIT'); return; }
        const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name.startsWith('.env') || /\.(pem|key|p12|pfx)$/i.test(entry.name)) continue;
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) { await visit(filename, depth + 1); continue; }
            if (!entry.isFile()) continue;
            if (++count > maxFiles) fail('DISCOVERY_LIMIT', 'Project exceeds the chatbot source scan file limit');
            const relative = path.relative(realRoot, filename).replaceAll('\\', '/');
            const faqJson = /(?:^|\/)(?:faq|faqs|knowledge|knowledge[_-]base|kb)\.json$/i.test(relative);
            if (!sourceExtension.test(relative) && !/\.(md|txt)$/i.test(relative) && !faqJson && !['package.json', 'requirements.txt', 'pyproject.toml'].includes(entry.name)) continue;
            const stat = await fs.stat(filename);
            if (stat.size > 512 * 1024) { warnings.push(`LARGE_FILE:${relative}`); continue; }
            bytes += stat.size;
            if (bytes > maxBytes) fail('DISCOVERY_LIMIT', 'Project exceeds the chatbot source scan byte limit');
            const content = await fs.readFile(filename, 'utf8');
            manifests.push({ file: relative, hash: hash(content) });
            if (entry.name === 'package.json') {
                try {
                    const pkg = JSON.parse(content);
                    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
                    packages.push({ directory: path.posix.dirname(relative), name: typeof pkg.name === 'string' ? pkg.name : relative, dependencies, scripts: Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([, value]) => typeof value === 'string')), providerDependencies: dependencies.filter(d => providerSignal.test(d)), runtime: 'NODE' });
                } catch { warnings.push(`INVALID_PACKAGE:${relative}`); }
            } else if (entry.name === 'requirements.txt') pythonPackages.push(path.posix.dirname(relative));
            else if (sourceExtension.test(relative)) {
                if (/\.(test|spec)\.|(?:^|\/)(?:tests?|__tests__|fixtures)\//i.test(relative)) continue;
                if (relative.endsWith('.py')) {
                    if (/(?:^|\n)\s*(?:import\s+chainlit\b|from\s+chainlit[.\s])/.test(content)) chainlitFiles.push(relative);
                    if (/@\w+\.on_message\b/.test(content) && /(?:import\s+chainlit\b|from\s+chainlit\b)/.test(content)) chainlitCallbacks.push(relative);
                    for (const match of content.matchAll(/\bmount_chainlit\(([\s\S]{0,4000}?)\)/g)) {
                        const target = /\btarget\s*=\s*['"]([^'"]+\.py)['"]/.exec(match[1])?.[1];
                        const receiver = /\bapp\s*=\s*(\w+)/.exec(match[1])?.[1];
                        const endpoint = /\bpath\s*=\s*['"]([^'"]+)['"]/.exec(match[1])?.[1] || '/chainlit';
                        if (!target || !receiver || !endpoint.startsWith('/') || endpoint.startsWith('//')) continue;
                        const callback = path.posix.normalize(path.posix.join(path.posix.dirname(relative), target));
                        if (callback.startsWith('../') || path.posix.isAbsolute(callback)) continue;
                        mountedChainlit.add(callback);
                        const authRoutes = [...content.matchAll(/@(\w+)\.get\(\s*['"]([^'"]+)['"][^\n]*\)\s*\n(?:async\s+)?def\s+\w+[^\n]*\n([\s\S]*?)(?=\n\S|$)/g)].filter(auth => auth[1] === receiver && /_authenticate_user\s*\(/.test(auth[3]) && auth[2].startsWith('/') && !auth[2].startsWith('//'));
                        routes.push({ file: relative, line: content.slice(0, match.index).split('\n').length, path: endpoint, framework: 'CHAINLIT', launchMode: 'FASTAPI_MOUNT', receiver, chainlitTarget: callback, authPath: authRoutes.length === 1 ? authRoutes[0][2] : null, inputFields: ['messages'], outputFields: [], mountResolved: true, protocolHints: ['CHAINLIT_SOCKET_IO'] });
                    }
                    const localRoutes = [...content.matchAll(/@(\w+)\.(post|route)\(\s*['"]([^'"]+)['"]([^\n]*)/g)].filter(m => m[2] === 'post' || /methods\s*=\s*\[[^\]]*['"]POST['"]/i.test(m[4])).filter(m => chatSignal.test(m[3]) || providerSignal.test(content)).map(m => ({ file: relative, line: content.slice(0, m.index).split('\n').length, path: m[3], method: 'POST', framework: /FastAPI/.test(content) ? 'FASTAPI' : 'PYTHON_HTTP', receiver: m[1], inputFields: [], outputFields: [], mountResolved: false }));
                    routes.push(...localRoutes);
                    const pythonInputFields = [...new Set([...content.matchAll(/\b\w+(?:\[\s*|\.get\(\s*)['"](messages|message|prompt|question|query|input)['"]/g)].map(match => match[1]))];
                    for (const route of localRoutes) { Object.assign(route, transportHints(content)); route.inputFields = pythonInputFields; }
                    for (const match of content.matchAll(/(?:os\.(?:getenv|environ\.get)\(\s*|os\.environ\[\s*)['"]([A-Z][A-Z0-9_]*)['"]/g)) environment.add(match[1]);
                    files.push({ file: relative, providerSignal: providerSignal.test(content), routeCount: localRoutes.length });
                } else {
                    const result = inspectJavaScript(relative, content);
                    modules.push({ file: relative, ...result });
                    routes.push(...result.routes); result.environment.forEach(name => environment.add(name));
                    files.push({ file: relative, providerSignal: result.imports.some(i => providerSignal.test(i)), routeCount: result.routes.length, parseError: result.parseError });
                    // Resolve literal same-file app.use('/prefix', router) mounts. Cross-file mounts remain explicit candidates.
                    for (const route of result.routes) {
                        const mounts = result.mounts?.filter(m => m.router === route.receiver) || [];
                        if (mounts.length === 1) { route.path = mounts[0].prefix.replace(/\/$/, '') + route.path; route.mountResolved = true; }
                        else if (route.receiver === 'app' && !mounts.length) route.mountResolved = true;
                    }
                }
            } else if ((/\.(md|txt)$/i.test(relative) || faqJson) && !['requirements.txt', 'LICENSE', 'LICENSE.txt'].includes(entry.name)) {
                sources.push({ file: relative, contentHash: hash(content), characters: content.length });
            }
        }
    }
    await visit(realRoot, 0);
    const moduleByFile = new Map(modules.map(module => [module.file, module]));
    const localDependencyFiles = file => {
        const visited = new Set(), pending = [file];
        while (pending.length) {
            const current = pending.pop();
            if (visited.has(current)) continue;
            visited.add(current);
            for (const imported of moduleByFile.get(current)?.imports || []) if (imported.startsWith('.')) {
                const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(current), imported));
                const match = [resolved, ...['.js', '.cjs', '.mjs', '.ts', '/index.js', '/index.ts'].map(suffix => resolved + suffix)].find(name => moduleByFile.has(name));
                if (match) pending.push(match);
            }
        }
        return [...visited];
    };
    const socketChatbots = modules.filter(module => module.imports.includes('socket.io')).flatMap(module => {
        const inputEvents = module.socketEvents.filter(item => item.method === 'on' && /user|chat|message|prompt|ask/i.test(item.event));
        const outputEvents = module.socketEvents.filter(item => item.method === 'emit' && /bot|assistant|reply|response|answer/i.test(item.event));
        const dependencyFiles = localDependencyFiles(module.file);
        const providerEvidence = dependencyFiles.some(file => moduleByFile.get(file)?.imports.some(name => providerSignal.test(name)));
        return inputEvents.length && outputEvents.length && providerEvidence ? [{ protocol: 'SOCKET_IO_CUSTOM', file: module.file, inputEvents, outputEvents, dependencyFiles, adapterAvailable: false }] : [];
    });
    for (const file of chainlitCallbacks) if (!mountedChainlit.has(file)) routes.push({ file, line: 1, path: '/', framework: 'CHAINLIT', launchMode: 'CHAINLIT_CLI', authPath: null, inputFields: ['messages'], outputFields: [], mountResolved: true });
    for (const route of routes.filter(r => !r.mountResolved)) {
        const prefixes = [];
        for (const module of modules) for (const mount of module.mounts || []) {
            const binding = module.importBindings?.find(item => item.local === mount.router && item.source.startsWith('.'));
            if (!binding) continue;
            const imported = path.posix.normalize(path.posix.join(path.posix.dirname(module.file), binding.source));
            if ([imported, `${imported}.js`, `${imported}.ts`, `${imported}/index.js`, `${imported}/index.ts`].includes(route.file)) prefixes.push(mount.prefix);
        }
        if (prefixes.length === 1) { route.path = prefixes[0].replace(/\/$/, '') + route.path; route.mountResolved = true; }
    }
    for (const route of routes) {
        const owners = packages.filter(pkg => pkg.directory === '.' || route.file.startsWith(pkg.directory + '/')).sort((a, b) => b.directory.length - a.directory.length);
        const pkg = owners[0];
        const pythonRoot = pythonPackages.filter(directory => directory === '.' || route.file.startsWith(directory + '/')).sort((a, b) => b.length - a.length)[0];
        route.packageDirectory = route.file.endsWith('.py') ? pythonRoot || path.posix.dirname(route.file) : pkg?.directory || path.posix.dirname(route.file);
        const scriptOrder = /\bnext\s+start\b/.test(pkg?.scripts.start || '') && pkg?.scripts.dev ? ['dev', 'start', 'serve'] : ['start', 'dev', 'serve'];
        route.startScript = scriptOrder.find(name => pkg?.scripts[name]) || null;
        route.requestField = ['messages', 'message', 'prompt', 'question', 'query', 'input'].find(name => route.inputFields.includes(name)) || null;
        route.answerField = ['answer', 'reply', 'response', 'content', 'message', 'text'].find(name => route.outputFields.includes(name)) || null;
        route.portHints = [...new Set(modules.flatMap(module => module.portHints || []))];
        route.id = hash({ file: route.file, path: route.path, line: route.line }).slice(0, 24);
        route.adapterOptions = projectAdapterOptions(route);
        route.dependencyFiles = localDependencyFiles(route.file);
        route.environmentNames = [...new Set(route.dependencyFiles.flatMap(file => moduleByFile.get(file)?.environment || []))].sort();
    }
    const likely = routes.filter(r => r.framework === 'CHAINLIT' || chatSignal.test(r.path) || files.find(f => f.file === r.file)?.providerSignal);
    const langGraphClients = modules.filter(module => module.imports.some(name => /@langchain\/langgraph-sdk(?:\/|$)/.test(name))).map(module => ({ protocol: 'LANGGRAPH', file: module.file }));
    return {
        version: 'project-chatbot-discovery-v2', adapterCatalog: projectAdapterCatalog(), sourceHash: hash(manifests), manifest: manifests,
        status: likely.length === 0 ? socketChatbots.length ? 'CHATBOT_ADAPTER_REQUIRED' : chainlitFiles.length ? 'CHATBOT_PROTOCOL_UNSUPPORTED' : langGraphClients.length ? 'CHATBOT_BACKEND_REQUIRED' : 'CHATBOT_NOT_FOUND' : likely.length > 1 ? 'MULTIPLE_CANDIDATES' : 'CHATBOT_DETECTED',
        chatProtocols: [...(chainlitFiles.length ? [{ protocol: 'CHAINLIT', files: chainlitFiles, transport: 'WEBSOCKET_STREAMING' }] : []), ...socketChatbots],
        chatClients: langGraphClients,
        candidates: likely, packages, environmentNames: [...environment].sort(), knowledgeSources: sources,
        environmentAssessment: assessProjectEnvironment([...environment], [...likely.flatMap(candidate => candidate.environmentNames), ...socketChatbots.flatMap(chatbot => chatbot.dependencyFiles.flatMap(file => moduleByFile.get(file)?.environment || []))]),
        evidence: files.filter(f => f.providerSignal || f.routeCount), warnings: [...new Set(warnings)],
        runtimeVerified: false,
    };
}
