import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail, redact } from './common.js';
import { chainlitTransport } from './chainlitTransport.service.js';
import { selectPythonRuntime, sandboxStartupFailure } from './pythonRuntime.service.js';

const trusted = fileURLToPath(new URL('./runtime/', import.meta.url));
const runtimeNamespace = () => process.env.AI_EVALUATION_RUNTIME_NAMESPACE || (process.env.NODE_ENV === 'test' ? `covai-test-${process.pid}` : 'covai');
const exec = promisify(execFile);
const packProject = async (root, signal) => (await exec('tar', ['-C', root, '-cf', '-', '.'], { encoding: 'buffer', windowsHide: true, signal, timeout: 60000, maxBuffer: 128 * 1024 * 1024 })).stdout;
const excluded = new Set(['node_modules', '.git', '.agents', '.codex', '.env', '.npmrc', '.yarnrc', '.pypirc', '.venv', 'venv', '.covai-temp', 'coverage']);
async function runtimeImage(kind, docker, signal, pythonVersion = '3.12') {
    const names = kind === 'node' ? ['Dockerfile.node', 'egressProxy.mjs', 'request.mjs'] : [`Dockerfile.${kind}`, 'request.py', 'chainlit_client.py'];
    const digest = crypto.createHash('sha256');
    for (const name of names) digest.update(await fs.readFile(path.join(trusted, name)));
    if (kind !== 'node') digest.update(pythonVersion);
    const image = `covai-chatbot-${kind}:${digest.digest('hex').slice(0, 16)}`;
    try { await docker(['image', 'inspect', image], { signal, timeout: 10000 }); }
    catch { await docker(['build', ...(kind !== 'node' ? ['--build-arg', `PYTHON_VERSION=${pythonVersion}`] : []), '-f', path.join(trusted, `Dockerfile.${kind}`), '-t', image, trusted], { signal, timeout: 240000 }); }
    return image;
}
export function dockerCommand(args, { input, signal, timeout = 120000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', args, { windowsHide: true, shell: false, signal });
        let stdout = '', stderr = '', timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
        child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2 * 1024 * 1024) child.kill(); });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve(stdout.trim()) : reject(Object.assign(new Error('Sandbox command failed'), { code: timedOut ? 'SANDBOX_COMMAND_TIMEOUT' : 'SANDBOX_COMMAND_FAILED', diagnostic: stderr })); });
        child.stdin.on('error', () => {}); child.stdin.end(input);
    });
}
export async function freezeProjectSource(root, destination, { signal, maxEntries = 15000, maxBytes = 96 * 1024 * 1024 } = {}) {
    const original = await fs.realpath(root);
    let entries = 0, bytes = 0;
    await fs.cp(original, destination, { recursive: true, dereference: false, errorOnExist: true, force: false, filter: async source => {
        signal?.throwIfAborted();
        const name = path.basename(source);
        if (source !== original && (excluded.has(name) || name.startsWith('.env.') || /\.(pem|key|p12|pfx)$/i.test(name))) return false;
        const stat = await fs.lstat(source);
        if (!stat.isDirectory() && !stat.isFile()) return false;
        entries++; if (stat.isFile()) bytes += stat.size;
        const relative = path.relative(original, source).replaceAll('\\', '/') || '.';
        if (entries > maxEntries) fail('PROJECT_SOURCE_LIMIT', `Application exceeds limit of ${maxEntries} files/folders during test preparation: ${relative}`, 413);
        if (stat.isFile() && stat.size > 20 * 1024 * 1024) fail('PROJECT_SOURCE_LIMIT', `File ${relative} (${(stat.size / 1048576).toFixed(2)} MiB) exceeds 20 MiB/file test sandbox limit`, 413);
        if (bytes > maxBytes) fail('PROJECT_SOURCE_LIMIT', `Application source exceeds ${(maxBytes / 1048576).toFixed(0)} MiB limit at ${relative}`, 413);
        if (path.relative(original, source).split(path.sep).length > 32) fail('PROJECT_SOURCE_LIMIT', `Application directory exceeds 32 nested levels: ${relative}`, 413);
        return true;
    } });
}

/** Docker-only runtime. No application port, Docker socket, host directory or platform secret is mounted. */
export async function startProjectSandbox({ root, candidate, environment = {}, signal, ownerId, onProgress = async () => {}, docker = dockerCommand, archive = packProject, protocolTransport = chainlitTransport }) {
    const id = `covai-chatbot-${crypto.randomBytes(10).toString('hex')}`;
    const network = `${id}-net`, proxy = `${id}-proxy`;
    const secrets = Object.values(environment);
    if (ownerId && !/^[\w-]{1,128}$/.test(ownerId)) fail('INVALID_SANDBOX_OWNER', 'Invalid evaluation identity');
    const ownerLabels = ['--label', `covai.namespace=${runtimeNamespace()}`, ...(ownerId ? ['--label', `covai.evaluationId=${ownerId}`] : [])];
    const directory = candidate.packageDirectory || '.';
    if (path.posix.isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) fail('INVALID_RUNTIME_DIRECTORY', 'Invalid application package directory');
    if (Object.entries(environment).some(([key, value]) => !/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.length > 10000 || /^(NODE_OPTIONS|NODE_PATH|PATH|LD_.*|PYTHONPATH|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NPM_CONFIG_.*|npm_config_.*|PORT|HOST)$/i.test(key))) fail('INVALID_RUNTIME_ENVIRONMENT', 'Unsupported runtime environment override');
    const created = [];
    const sessions = new Set();
    let disposed = false, cleanupComplete = false, networkCreated = false;
    let stage = 'PREPARING_RUNTIME', pythonRuntime;
    const cleanup = async () => {
        if (cleanupComplete) return; disposed = true;
        const failures = [];
        await Promise.allSettled([...sessions].map(session => session.close())); sessions.clear();
        for (const name of [...created].reverse()) try { await docker(['rm', '-f', name], { timeout: 15000 }); created.splice(created.indexOf(name), 1); } catch { failures.push(name); }
        if (networkCreated) try { await docker(['network', 'rm', network], { timeout: 15000 }); networkCreated = false; } catch { failures.push(network); }
        if (failures.length) fail('SANDBOX_CLEANUP_FAILED', 'Some evaluation containers could not be removed', 503);
        cleanupComplete = true;
    };
    try {
        try { await docker(['version', '--format', '{{.Server.Version}}'], { signal, timeout: 10000 }); }
        catch { fail('SANDBOX_UNAVAILABLE', 'Docker sandbox is unavailable on the evaluation worker; project source was not executed', 503); }
        const nodeImage = await runtimeImage('node', docker, signal);
        await docker(['network', 'create', '--internal', '--label', 'covai.purpose=chatbot-evaluation', ...ownerLabels, network], { signal });
        networkCreated = true;
        await docker(['create', '--name', proxy, '--label', 'covai.purpose=chatbot-evaluation', ...ownerLabels, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--pids-limit=32', '--user=1000:1000', nodeImage, 'node', '/covai/egressProxy.mjs'], { signal }); created.push(proxy);
        await docker(['network', 'connect', '--alias', 'evaluation-egress', network, proxy], { signal });
        await docker(['start', proxy], { signal });
        const isChainlit = candidate.framework === 'CHAINLIT';
        const python = isChainlit || ['FASTAPI', 'PYTHON_HTTP'].includes(candidate.framework);
        const hasRequirements = await fs.access(path.join(root, directory, 'requirements.txt')).then(() => true).catch(() => false);
        const compatibilityRuntime = isChainlit && !hasRequirements;
        pythonRuntime = python ? await selectPythonRuntime(root, directory) : null;
        if (pythonRuntime) await onProgress('PREPARING_RUNTIME', { pythonRuntime });
        const applicationImage = python ? await runtimeImage(compatibilityRuntime ? 'chainlit' : 'python', docker, signal, pythonRuntime.version) : nodeImage;
        const generatedSecrets = isChainlit && !environment.CHAINLIT_AUTH_SECRET ? [crypto.randomBytes(32).toString('hex')] : [];
        const appEnvironment = { ...environment, ...(generatedSecrets.length ? { CHAINLIT_AUTH_SECRET: generatedSecrets[0] } : {}) };
        const dependencyProvenance = compatibilityRuntime ? { kind: 'COVAI_COMPATIBILITY_PROFILE', id: 'chainlit-2.9.4-openai-1.109.1-v1', complete: false } : { kind: python ? 'PROJECT_REQUIREMENTS' : 'PROJECT_PACKAGE', complete: true };
        dependencyProvenance.imageReference = applicationImage;
        if (pythonRuntime) dependencyProvenance.pythonRuntime = pythonRuntime;
        if (!python && !candidate.startScript) fail('START_SCRIPT_MISSING', 'No start, dev or serve script was found for the chatbot package');
        const proxyUrl = 'http://evaluation-egress:3128';
        const env = { PORT: '3000', HOST: '0.0.0.0', NODE_ENV: 'development', NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1', npm_config_proxy: proxyUrl, npm_config_https_proxy: proxyUrl, npm_config_cache: '/tmp/npm-cache', ...(python ? { PYTHONPATH: '/workspace/.covai-python-packages', PYTHONUNBUFFERED: '1' } : {}) };
        await docker(['create', '--name', id, '--label', 'covai.purpose=chatbot-evaluation', ...ownerLabels, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=768m', '--cpus=1', '--pids-limit=128', '--user=1000:1000', '--tmpfs', '/tmp:rw,nosuid,noexec,size=256m,uid=1000,gid=1000', '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=768m,uid=1000,gid=1000', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), applicationImage, ...(python ? ['python', '-c', 'import time; time.sleep(1800)'] : ['node', '-e', 'setTimeout(()=>process.exit(0),1800000)'])], { signal }); created.push(id);
        await docker(['start', id], { signal });
        const imageId = await docker(['inspect', id, '--format', '{{.Image}}'], { signal, timeout: 10000 });
        if (/^sha256:[a-f0-9]{64}$/.test(imageId)) dependencyProvenance.imageDigest = imageId;
        stage = 'COPYING_SOURCE';
        await docker(['exec', '-i', id, 'tar', '--no-same-owner', '-xf', '-', '-C', '/workspace'], { input: await archive(root, signal), signal });
        const cwd = path.posix.join('/workspace', directory);
        let lock = false;
        try { await fs.access(path.join(root, directory, 'package-lock.json')); lock = true; } catch { /* npm install for packages without a lockfile */ }
        await onProgress('INSTALLING_DEPENDENCIES', { pythonRuntime });
        stage = 'INSTALLING_DEPENDENCIES';
        if (python) {
            if (!hasRequirements && !compatibilityRuntime) fail('DEPENDENCY_MANIFEST_MISSING', 'Python chatbot requires a requirements.txt file to reproduce its dependencies');
            if (hasRequirements) await docker(['exec', '-w', cwd, id, 'python', '-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '--no-cache-dir', '--target', '/workspace/.covai-python-packages', '-r', 'requirements.txt'], { signal, timeout: 240000 });
        } else await docker(['exec', '-w', cwd, id, 'npm', lock ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'], { signal, timeout: 240000 });
        await onProgress('STARTING_CHATBOT', { pythonRuntime });
        stage = 'STARTING_CHATBOT';
        const extraEnv = Object.entries(appEnvironment).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
        const moduleName = path.posix.relative(directory, candidate.file).replace(/\.py$/, '').replaceAll('/', '.');
        const start = isChainlit && candidate.launchMode === 'CHAINLIT_CLI' ? ['python', '-m', 'chainlit', 'run', path.posix.relative(directory, candidate.file), '--host', '0.0.0.0', '--port', '3000', '--headless'] : python ? (candidate.framework === 'FASTAPI' || isChainlit ? ['python', '-m', 'uvicorn', `${moduleName}:${candidate.receiver || 'app'}`, '--host', '0.0.0.0', '--port', '3000'] : ['python', path.posix.relative(directory, candidate.file)]) : ['npm', 'run', candidate.startScript];
        await docker(['exec', '-d', '-w', cwd, ...extraEnv, id, 'sh', '-c', 'exec "$@" > /tmp/chatbot.log 2>&1', 'covai-start', ...start], { signal });
        const request = async (body, { port = 3000, timeoutMs = 60000, path: endpoint = candidate.path, signal: turnSignal, method = 'POST' } = {}) => {
            if (disposed) fail('SANDBOX_CLOSED', 'The evaluation sandbox has closed');
            const requestSignal = signal && turnSignal ? AbortSignal.any([signal, turnSignal]) : turnSignal || signal;
            const raw = await docker(['exec', '-i', id, ...(python ? ['python', '-I', '/covai/request.py'] : ['node', '/covai/request.mjs'])], { input: JSON.stringify({ port, path: endpoint, body, timeoutMs, method }), signal: requestSignal, timeout: timeoutMs + 5000 });
            const result = JSON.parse(raw);
            if (result.transportError) fail(result.transportError === 'LOCAL_CONNECTION_REFUSED' && result.dispatched === false ? 'LOCAL_CONNECTION_REFUSED' : 'LOCAL_REQUEST_FAILED', 'Local chatbot request failed; dispatched operations are not replayed', 502);
            return result;
        };
        const openChainlitSession = async ({ signal: turnSignal } = {}) => {
            if (disposed) fail('SANDBOX_CLOSED', 'The evaluation sandbox has closed');
            const transport = protocolTransport(id);
            const session = { turn: (content, { signal: requestSignal, timeoutMs = 60000 } = {}) => transport.request({ op: 'turn', content, timeoutMs }, { signal: requestSignal || turnSignal || signal, timeoutMs: timeoutMs + 2000 }), close: async () => { sessions.delete(session); await transport.close(); } };
            sessions.add(session);
            try { await transport.request({ op: 'connect', port: 3000, path: candidate.path, authPath: candidate.authPath }, { signal: turnSignal || signal, timeoutMs: 35000 }); return session; }
            catch (error) { await session.close(); throw error; }
        };
        return { id, request, cleanup, openChainlitSession, dependencyProvenance, generatedSecrets, logs: async () => redact(await docker(['exec', id, 'tail', '-c', '4000', '/tmp/chatbot.log']).catch(() => ''), [...secrets, ...generatedSecrets]) };
    } catch (error) {
        await cleanup().catch(() => {});
        if (error.statusCode) throw error;
        const failure = sandboxStartupFailure(stage, error, pythonRuntime);
        fail(signal?.aborted ? 'RUN_CANCELED' : failure.code, signal?.aborted ? 'Evaluation canceled' : failure.message, 422);
    }
}

export async function cleanupProjectSandbox(ownerId, docker = dockerCommand) {
    if (!/^[\w-]{1,128}$/.test(ownerId)) fail('INVALID_SANDBOX_OWNER', 'Invalid evaluation identity');
    const filter = `label=covai.evaluationId=${ownerId}`;
    const namespace = ['--filter', `label=covai.namespace=${runtimeNamespace()}`];
    const containers = (await docker(['ps', '-a', '--filter', filter, ...namespace, '--format', '{{.Names}}'], { timeout: 10000 })).split(/\r?\n/).filter(Boolean);
    const networks = (await docker(['network', 'ls', '--filter', filter, ...namespace, '--format', '{{.Name}}'], { timeout: 10000 })).split(/\r?\n/).filter(Boolean);
    if (containers.some(name => !/^covai-chatbot-[a-f0-9]{20}(?:-proxy)?$/.test(name)) || networks.some(name => !/^covai-chatbot-[a-f0-9]{20}-net$/.test(name))) fail('INVALID_SANDBOX_RESOURCE', 'Unexpected resource returned by Docker cleanup query');
    for (const name of containers) await docker(['rm', '-f', name], { timeout: 15000 });
    for (const name of networks) await docker(['network', 'rm', name], { timeout: 15000 });
}

/** Retry orphan cleanup after cancellation, process crashes or temporary Docker failures. */
export async function reconcileProjectSandboxResources(db, docker = dockerCommand) {
    const namespace = ['--filter', `label=covai.namespace=${runtimeNamespace()}`];
    const raw = await docker(['ps', '-a', '--filter', 'label=covai.purpose=chatbot-evaluation', ...namespace, '--format', '{{.Label "covai.evaluationId"}}'], { timeout: 10000 });
    const networkIds = (await docker(['network', 'ls', '--filter', 'label=covai.purpose=chatbot-evaluation', ...namespace, '--format', '{{.ID}}'], { timeout: 10000 })).split(/\r?\n/).filter(Boolean);
    const owners = new Set(raw.split(/\r?\n/).filter(id => /^[\w-]{1,128}$/.test(id)));
    for (const id of networkIds) {
        if (!/^[a-f0-9]{12,64}$/.test(id)) continue;
        const owner = await docker(['network', 'inspect', id, '--format', '{{index .Labels "covai.evaluationId"}}'], { timeout: 10000 });
        if (/^[\w-]{1,128}$/.test(owner)) owners.add(owner);
    }
    for (const ownerId of owners) {
        const row = await db.aiEvaluationProjectRun.findUnique({ where: { id: ownerId }, select: { status: true } });
        if (row && ['QUEUED', 'RUNNING'].includes(row.status)) continue;
        await cleanupProjectSandbox(ownerId, docker);
    }
}
