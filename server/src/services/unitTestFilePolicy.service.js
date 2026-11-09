import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { minimatch } from 'minimatch';
import { parseJavaScriptCode } from './babelParser.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { recordUnitTestWork } from './unitTestWork.service.js';

const ignoredDirectories = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', '.vite', '.vitest', '.svelte-kit', '.output', 'storage', 'uploads']);
const configNames = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.cts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'jest.config.js', 'jest.config.cjs', 'jest.config.ts', 'jest.config.mjs', 'jest.config.json'];
const cache = new Map();
const configurationCache = new Map();
const normalize = value => value.replaceAll('\\', '/');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const conventional = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const fixtures = /(?:^|\/)(?:test[-_]data|fixtures?|__fixtures__|__mocks__|mocks?|helpers?|support|utils)(?:\/|$)/i;

function hasTestRegistration(content, filePath) {
    const parsed = parseJavaScriptCode(content, { filePath });
    if (!parsed.success) return false;
    const names = new Set(['describe', 'test', 'it', 'suite', 'defineFeature', 'scenario']);
    for (const node of parsed.ast.program.body) if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) if (names.has(specifier.imported?.name)) names.add(specifier.local.name);
    }
    const visit = node => {
        if (!node || typeof node !== 'object') return false;
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration'].includes(node.type)) return false;
        if (node.type === 'CallExpression') {
            let callee = node.callee;
            while (['MemberExpression', 'CallExpression'].includes(callee?.type)) callee = callee.object || callee.callee;
            if (names.has(callee?.name)) return true;
        }
        return Object.entries(node).some(([key, value]) => !['loc', 'comments', 'tokens'].includes(key) &&
            (Array.isArray(value) ? value.some(visit) : visit(value)));
    };
    return parsed.ast.program.body.some(visit);
}

function staticConfiguration(file, source) {
    const key = `${file}:${digest(source)}`;
    if (configurationCache.has(key)) return configurationCache.get(key);
    const configuration = readStaticConfiguration(file, source);
    configurationCache.set(key, configuration);
    while (configurationCache.size > 64) configurationCache.delete(configurationCache.keys().next().value);
    return configuration;
}

function readStaticConfiguration(file, source) {
    if (file.endsWith('.json')) {
        try { return JSON.parse(source); } catch { return {}; }
    }
    const parsed = parseJavaScriptCode(source, { filePath: file });
    if (!parsed.success) return { unresolved: true };
    const bindings = new Map();
    for (const node of parsed.ast.program.body) if (node.type === 'VariableDeclaration') {
        for (const declaration of node.declarations) if (declaration.id.type === 'Identifier') bindings.set(declaration.id.name, declaration.init);
    }
    const evaluate = (node, seen = new Set()) => {
        if (!node || seen.has(node)) return undefined;
        const visited = new Set(seen).add(node);
        if (node.type === 'Identifier') return node.name === '__dirname' ? path.dirname(file) : evaluate(bindings.get(node.name), visited);
        if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
        if (node.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
        if (node.type === 'RegExpLiteral') return new RegExp(node.pattern, node.flags);
        if (node.type === 'ArrayExpression') {
            const values = node.elements.map(item => evaluate(item, visited));
            return values.includes(undefined) ? undefined : values;
        }
        if (node.type === 'ObjectExpression' && !node.properties.some(item => item.type === 'SpreadElement')) return Object.fromEntries(node.properties
            .filter(item => item.type === 'ObjectProperty' && !item.computed)
            .map(item => [item.key.name || item.key.value, evaluate(item.value, visited)]));
        if (['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(node.type)) return evaluate(node.expression, visited);
        if (node.type === 'CallExpression' && node.callee.name === 'defineConfig') return evaluate(node.arguments[0], visited);
        if (node.type === 'CallExpression' && (node.callee.name === 'resolve' || node.callee.property?.name === 'resolve')) {
            const args = node.arguments.map(item => evaluate(item, visited));
            if (args.every(item => typeof item === 'string')) return path.resolve(...args);
        }
        return undefined;
    };
    const exported = parsed.ast.program.body.find(node => node.type === 'ExportDefaultDeclaration');
    const assignment = parsed.ast.program.body.find(node => node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' &&
        node.expression.left.object?.name === 'module' && node.expression.left.property?.name === 'exports');
    return evaluate(exported?.declaration || assignment?.expression.right) || { unresolved: true };
}

function runnerPolicy(root, file, framework) {
    let directory = path.dirname(file);
    const configuration = {};
    while (true) {
        const manifest = path.join(directory, 'package.json');
        let pkg;
        try { pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { /* Optional package boundary. */ }
        // Honor an explicit config selected by the package's runner script.
        // Read literal paths only; never execute project configuration here.
        const script = Object.values(pkg?.scripts || {}).find(value => typeof value === 'string' &&
            new RegExp(`(?:^|\\s)${framework}\\b`).test(value) && /--config(?:=|\s)/.test(value));
        const configured = script?.match(/--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
        if (configured) {
            const absolute = path.resolve(directory, configured[1] || configured[2] || configured[3]);
            const relative = path.relative(root, absolute);
            if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
                return { directory, configFile: normalize(relative), config: staticConfiguration(absolute, fs.readFileSync(absolute, 'utf8')) };
            }
        }
        const names = framework === 'vitest' ? configNames.filter(name => /^(?:vite|vitest)\./.test(name)) : configNames.filter(name => name.startsWith('jest.'));
        const config = names.find(name => fs.existsSync(path.join(directory, name)));
        if (config) {
            const absolute = path.join(directory, config);
            Object.assign(configuration, staticConfiguration(absolute, fs.readFileSync(absolute, 'utf8')));
            return { directory, configFile: normalize(path.relative(root, absolute)), config: configuration };
        }
        if (framework !== 'vitest' && pkg?.jest) return { directory, configFile: normalize(path.relative(root, manifest)), config: pkg.jest };
        if (directory === root) break;
        directory = path.dirname(directory);
    }
    return { directory: root, configFile: null, config: {} };
}

function matchesConfiguredTests(policy, absolute, framework) {
    if (policy.config.unresolved) return false;
    const config = framework === 'vitest' ? policy.config.test || {} : policy.config;
    if (framework === 'vitest' && Object.hasOwn(policy.config,'test') && !policy.config.test) return false;
    if (Object.hasOwn(config,framework === 'vitest' ? 'include' : 'testMatch') && !Array.isArray(config[framework === 'vitest' ? 'include' : 'testMatch'])) return false;
    const configuredRoot = policy.config.root || config.rootDir;
    const directory = typeof configuredRoot === 'string' ? path.resolve(policy.directory, configuredRoot.replaceAll('<rootDir>', policy.directory)) : policy.directory;
    const relative = normalize(path.relative(directory, absolute));
    const match = pattern => typeof pattern === 'string' && minimatch(relative, normalize(pattern.replaceAll('<rootDir>/', '')).replace(`${normalize(directory)}/`, ''), { dot: true });
    const excluded = framework === 'vitest' ? config.exclude : config.testPathIgnorePatterns;
    if (Array.isArray(excluded) && excluded.some(pattern => {
        if (framework === 'vitest') return match(pattern);
        try { return new RegExp(pattern.replaceAll('<rootDir>', normalize(directory))).test(normalize(absolute)); } catch { return false; }
    })) return false;
    const patterns = framework === 'vitest' ? config.include : config.testMatch;
    if (Array.isArray(patterns)) return patterns.some(match);
    if (framework !== 'vitest' && config.testRegex) {
        return [config.testRegex].flat().some(pattern => {
            try { return new RegExp(pattern).test(normalize(absolute)); } catch { return false; }
        });
    }
    return conventional.test(relative) || /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/i.test(relative);
}

export function classifyUnitTestPath(rootDir, filePath, framework = null, { content: suppliedContent, policies = new Map() } = {}) {
    const root = path.resolve(rootDir);
    const absolute = path.resolve(root, filePath);
    const relative = normalize(path.relative(root, absolute));
    const result = { filePath: relative, role: 'SOURCE', writable: false, framework };
    const configurationFor = runner => {
        const key = `${path.dirname(absolute)}:${runner}`;
        if (!policies.has(key)) policies.set(key, runnerPolicy(root, absolute, runner));
        return policies.get(key);
    };
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return { ...result, role: 'INVALID', reason: 'Path escapes the workspace' };
    if (relative.split('/').some(part => ignoredDirectories.has(part) || part.startsWith('.covai'))) return { ...result, role: 'INVALID', reason: 'Runtime or protected directory' };
    let current = root;
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return { ...result, role: 'INVALID', reason: 'Symbolic test targets are not writable' };
    }
    if (!framework) {
        const content = suppliedContent ?? (fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? fs.readFileSync(absolute, 'utf8') : '');
        framework = /(?:from\s*['"]vitest['"]|\bvi\.)/.test(content) || /(?:^|[/.])vitest[/.]/.test(relative) ? 'vitest' :
            /(?:@jest\/|\bjest\.)/.test(content) || /\.jest\./.test(relative) ? 'jest' : null;
        if (!framework) {
            const vitest = configurationFor('vitest');
            const jest = configurationFor('jest');
            const vitestMatches = matchesConfiguredTests(vitest, absolute, 'vitest');
            framework = vitest.configFile && vitestMatches && (!jest.configFile || !matchesConfiguredTests(jest, absolute, 'jest') || vitest.directory.length > jest.directory.length) ? 'vitest' : 'jest';
        }
        result.framework = framework;
    }
    if (!/\.[cm]?[jt]sx?$/i.test(relative) || /\.d\.[cm]?ts$/i.test(relative) || /(?:^|\/)(?:[^/]*\.config\.[^/]+|setup(?:[-._]?tests?)?\.[^/]+|global[-._]setup\.[^/]+|(?:vitest|jest)[-._]setup\.[^/]+)$/i.test(relative)) {
        return { ...result, role: 'CONFIG', reason: 'Configuration, setup or non-executable file' };
    }
    const isFixture = fixtures.test(relative) && /(?:^|\/)(?:specs?|tests?|__tests__)(?:\/|$)/i.test(relative);
    if (isFixture && !conventional.test(relative) && !/\.steps?\.[cm]?[jt]sx?$/i.test(relative)) return { ...result, role: 'FIXTURE', reason: 'Fixture or test helper module' };
    const policy = configurationFor(framework);
    let runnable = matchesConfiguredTests(policy, absolute, framework);
    if (runnable && fs.existsSync(absolute)) {
        const content = suppliedContent ?? fs.readFileSync(absolute,'utf8');
        if (/(?:from\s*|require\s*\(\s*)['"](?:@playwright\/test|cypress)['"]/.test(content) || /(?:^|\/)(?:e2e|cypress|playwright)(?:\/|$)/.test(relative)) {
            return {...result,role:'SYSTEM_TEST',reason:'System test suites are outside unit test generation'};
        }
        if (/(?:from\s*|require\s*\(\s*)['"]supertest['"]/.test(content)) return {...result,role:'INTEGRATION_TEST',reason:'Integration test suites are outside unit test generation'};
    }
    if (runnable && !conventional.test(relative) && fs.existsSync(absolute) && !hasTestRegistration(suppliedContent ?? fs.readFileSync(absolute, 'utf8'), relative)) {
        return { ...result, role: isFixture ? 'FIXTURE' : 'HELPER', reason: 'Module exports data or helpers without registering a runnable suite' };
    }
    return { ...result, role: runnable ? 'TEST' : isFixture ? 'FIXTURE' : 'SOURCE', writable: runnable,
        packageRoot: normalize(path.relative(root, policy.directory)), configFile: policy.configFile,
        reason: runnable ? 'Selected by the runner test patterns' : 'Not selected as a runnable suite by the runner configuration' };
}

export function assertUnitTestTarget(rootDir, filePath, framework = 'jest') {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new ServiceError('A runnable test destination is required. Regenerate the proposal.', 422, 'INVALID_TEST_TARGET');
    const target = classifyUnitTestPath(rootDir, filePath, framework);
    if (!target.writable) throw new ServiceError(`Invalid test target '${target.filePath}' (${target.role}): ${target.reason}. Regenerate the proposal for a runnable test suite.`, 422, 'INVALID_TEST_TARGET', target);
    return target;
}

export function assertUnitTestSource(rootDir, filePath, framework) {
    const source = classifyUnitTestPath(rootDir, filePath, framework);
    if (!['SOURCE', 'TEST'].includes(source.role)) throw new ServiceError(`Invalid unit test source '${source.filePath}' (${source.role}). Select a business source module or runnable suite.`, 422, 'INVALID_TEST_SOURCE', source);
    return source;
}

/** Propose a new suite only where the selected runner will collect it. This is
 * used before generation; an already reviewed proposal is never redirected. */
export function suggestUnitTestTarget(rootDir, sourceFile, framework, preferred) {
    if (preferred && classifyUnitTestPath(rootDir, preferred, framework).writable) return preferred;
    const root = path.resolve(rootDir);
    const policy = runnerPolicy(root, path.resolve(root, sourceFile), framework);
    const config = framework === 'vitest' ? policy.config.test || {} : policy.config;
    const directory = path.resolve(policy.directory, policy.config.root || config.rootDir?.replaceAll('<rootDir>', policy.directory) || '.');
    const base = path.basename(sourceFile).replace(/\.[cm]?[jt]sx?$/, '') + '.coverage';
    for (let pattern of (framework === 'vitest' ? config.include : config.testMatch) || []) {
        if (typeof pattern !== 'string' || /[!?()[\]]/.test(pattern)) continue;
        pattern = normalize(pattern).replaceAll('<rootDir>', normalize(directory));
        pattern = pattern.replace(/\{([^{}]+)\}/g, (_match, choices) => {
            const values = choices.split(',');
            return values.includes('test') ? 'test' : values.includes(path.extname(sourceFile).slice(1)) ? path.extname(sourceFile).slice(1) : values[0];
        }).replaceAll('**/', '').replaceAll('*', base);
        const candidate = normalize(path.relative(root, path.resolve(directory, pattern)));
        if (!fs.existsSync(path.resolve(root, candidate)) && classifyUnitTestPath(root, candidate, framework).writable) return candidate;
    }
    throw new ServiceError('No writable test destination matches the selected runner configuration. Select an existing runnable suite or configure a test include pattern.', 422, 'INVALID_TEST_TARGET');
}

export function unitTestInventory(rootDir) {
    const root = path.resolve(rootDir);
    const paths = [];
    const metadata = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (ignoredDirectories.has(entry.name) || entry.name.startsWith('.covai') || entry.isSymbolicLink()) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.isFile() && (/\.[cm]?[jt]sx?$/.test(entry.name) || ['package.json', 'jest.config.json'].includes(entry.name))) {
                const stat = fs.statSync(absolute);
                metadata.push(`${absolute}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
                if (/\.[cm]?[jt]sx?$/.test(entry.name)) paths.push(absolute);
            }
        }
    };
    const started = performance.now();
    visit(root);
    const identity = digest(metadata.sort().join('\n'));
    const existing = cache.get(root);
    if (existing?.identity === identity) {
        recordUnitTestWork('inventoryCacheHits');
        recordUnitTestWork('inventoryMs',performance.now() - started);
        return { ...existing.value, cacheHit: true, inventoryMs: performance.now() - started };
    }
    const tests = [];
    const policies = new Map();
    for (const absolute of paths) {
        const file = normalize(path.relative(root, absolute));
        const content = fs.readFileSync(absolute, 'utf8');
        const target = classifyUnitTestPath(root, file, null, { content, policies });
        if (target.writable) tests.push({ ...target, content, contentHash: digest(content) });
    }
    const value = { tests, sourcePaths: paths.map(file => normalize(path.relative(root,file))), identity, cacheHit: false, inventoryMs: performance.now() - started };
    recordUnitTestWork('inventoryBuilds');
    recordUnitTestWork('inventoryMs',value.inventoryMs);
    cache.delete(root);
    if (tests.reduce((bytes,test) => bytes + Buffer.byteLength(test.content),0) < 8 * 1024 * 1024) cache.set(root, { identity, value });
    while (cache.size > 12) cache.delete(cache.keys().next().value);
    return value;
}
