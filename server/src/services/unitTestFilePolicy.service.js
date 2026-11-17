import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { minimatch } from 'minimatch';
import { parseJavaScriptCode } from './babelParser.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { recordUnitTestWork } from './unitTestWork.service.js';
import { isCovaiJestArtifact } from '../utils/covaiJestArtifact.js';

const ignoredDirectories = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', '.vite', '.vitest', '.svelte-kit', '.output', 'storage', 'uploads']);
const configNames = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.cts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'jest.config.js', 'jest.config.cjs', 'jest.config.ts', 'jest.config.mjs', 'jest.config.json'];
const cache = new Map();
const configurationCache = new Map();
const normalize = value => value.replaceAll('\\', '/');
const contained = (directory, file) => {
    const rel = normalize(path.relative(directory, file));
    return rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel);
};
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
        if (node.type === 'CallExpression' && ['defineConfig', 'defineWorkspace', 'defineProject'].includes(node.callee.name)) return evaluate(node.arguments[0], visited);
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
    while (contained(root, directory)) {
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
        const workspace = framework === 'vitest' && ['vitest.workspace.ts', 'vitest.workspace.js', 'vitest.workspace.mjs']
            .find(name => fs.existsSync(path.join(directory, name)));
        if (workspace) {
            const absolute = path.join(directory, workspace);
            const projects = staticConfiguration(absolute, fs.readFileSync(absolute, 'utf8'));
            return { directory, configFile: normalize(path.relative(root, absolute)), config: Array.isArray(projects)
                ? { test: { projects } } : { unresolved: true } };
        }
        const config = names.find(name => fs.existsSync(path.join(directory, name)));
        if (config) {
            const absolute = path.join(directory, config);
            Object.assign(configuration, staticConfiguration(absolute, fs.readFileSync(absolute, 'utf8')));
            return { directory, configFile: normalize(path.relative(root, absolute)), config: configuration };
        }
        if (framework !== 'vitest' && pkg?.jest) return { directory, configFile: normalize(path.relative(root, manifest)), config: pkg.jest };
        if (directory === root || directory === path.dirname(directory)) break;
        directory = path.dirname(directory);
    }
    return { directory: root, configFile: null, config: {} };
}

function discoveryRule(policy, absolute, framework, depth = 0) {
    if (depth > 4 || policy.config.unresolved) return 'Configuration could not be resolved statically';
    const config = framework === 'vitest' ? policy.config.test || {} : policy.config;
    const selection = framework === 'vitest' ? 'include' : 'testMatch';
    if (framework === 'vitest' && Object.hasOwn(policy.config,'test') && !policy.config.test) return 'Unsupported Vitest test configuration';
    if (Object.hasOwn(config, selection) && !Array.isArray(config[selection])) return 'Unresolved ' + selection;
    const configuredRoot = policy.config.root || config.rootDir || config.root;
    const resolve = value => path.resolve(policy.directory, normalize(value).replaceAll('<rootDir>', normalize(policy.directory)));
    const directory = typeof configuredRoot === 'string' ? resolve(configuredRoot) : policy.directory;
    if (!contained(directory, absolute)) return 'Outside configured root ' + (configuredRoot || '.');
    if (Object.hasOwn(config, 'roots') && (!Array.isArray(config.roots) || !config.roots.some(root =>
        typeof root === 'string' && contained(path.resolve(directory, normalize(root).replaceAll('<rootDir>', normalize(directory))), absolute)))) {
        return 'Excluded by roots ' + JSON.stringify(config.roots ?? null);
    }
    const relative = normalize(path.relative(directory, absolute));
    const match = pattern => typeof pattern === 'string' && minimatch(relative, normalize(pattern.replaceAll('<rootDir>/', '')).replace(`${normalize(directory)}/`, ''), { dot: true });
    const excluded = framework === 'vitest' ? config.exclude : config.testPathIgnorePatterns;
    const ignoredBy = Array.isArray(excluded) && excluded.find(pattern => {
        if (framework === 'vitest') return match(pattern);
        if (typeof pattern !== 'string') return false;
        try { return new RegExp(pattern.replaceAll('<rootDir>', normalize(directory))).test(normalize(absolute)); } catch { return false; }
    });
    if (ignoredBy) return 'Excluded by ' + (framework === 'vitest' ? 'exclude' : 'testPathIgnorePatterns') + ' ' + ignoredBy;
    const projects = config.projects;
    if (Object.hasOwn(config, 'projects')) {
        if (!Array.isArray(projects)) return 'Unresolved projects configuration';
        const projectFailures = [];
        for (const entry of projects) {
            let project;
            if (entry && typeof entry === 'object') {
                project = { ...policy, directory, config: entry };
            } else if (typeof entry === 'string') {
                const pattern = normalize(entry).replaceAll('<rootDir>', normalize(directory));
                const base = path.resolve(directory, pattern);
                const candidates = [];
                if (!/[*?[\]{}]/.test(pattern)) candidates.push(base);
                else for (let ancestor = path.dirname(absolute); contained(directory, ancestor); ancestor = path.dirname(ancestor)) {
                    const names = [ancestor, ...configNames.map(name => path.join(ancestor, name))];
                    candidates.push(...names.filter(file => minimatch(normalize(file), normalize(base), { dot: true })));
                    if (ancestor === directory) break;
                }
                for (const candidate of candidates) {
                    if (!contained(directory, candidate) || !fs.existsSync(candidate)) continue;
                    const isDirectory = fs.statSync(candidate).isDirectory();
                    const candidateConfig = isDirectory ? runnerPolicy(candidate, path.join(candidate, 'test.js'), framework)
                        : { directory: path.dirname(candidate), config: staticConfiguration(candidate, fs.readFileSync(candidate, 'utf8')) };
                    const rejection = discoveryRule(candidateConfig, absolute, framework, depth + 1);
                    if (!rejection) return null;
                    projectFailures.push(rejection);
                }
            }
            if (project) {
                const rejection = discoveryRule(project, absolute, framework, depth + 1);
                if (!rejection) return null;
                projectFailures.push(rejection);
            }
        }
        return 'Not selected by projects' + (projectFailures.length ? ': ' + [...new Set(projectFailures)].join('; ') : '');
    }
    const patterns = framework === 'vitest' ? config.include : config.testMatch;
    if (Array.isArray(patterns) && !patterns.reduce((selected, pattern) => {
        if (typeof pattern !== 'string') return selected;
        return pattern.startsWith('!') ? (match(pattern.slice(1)) ? false : selected) : selected || match(pattern);
    }, false)) return 'Does not match ' + selection + ' ' + JSON.stringify(patterns);
    if (Array.isArray(patterns)) return null;
    if (framework !== 'vitest' && config.testRegex) {
        const matches = [config.testRegex].flat().some(pattern => {
            try { return new RegExp(pattern).test(normalize(absolute)); } catch { return false; }
        });
        return matches ? null : 'Does not match testRegex ' + JSON.stringify(config.testRegex);
    }
    return conventional.test(relative) || (framework === 'jest' && /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/i.test(relative))
        ? null : 'Does not match default ' + framework + ' suite naming';
}

function matchesConfiguredTests(policy, absolute, framework) {
    return discoveryRule(policy, absolute, framework) === null;
}

export function classifyUnitTestPath(rootDir, filePath, framework = null, { content: suppliedContent, policies = new Map() } = {}) {
    const root = path.resolve(rootDir);
    const absolute = path.resolve(root, normalize(filePath));
    const relative = normalize(path.relative(root, absolute));
    const result = { filePath: relative, role: 'SOURCE', writable: false, framework };
    const configurationFor = runner => {
        const key = `${path.dirname(absolute)}:${runner}`;
        if (!policies.has(key)) policies.set(key, runnerPolicy(root, absolute, runner));
        return policies.get(key);
    };
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return { ...result, role: 'INVALID', reason: 'Path escapes the workspace' };
    if (isCovaiJestArtifact(relative)) return { ...result, role: 'RUNTIME', reason: 'CovAI Jest runner file or a suite generated from it' };
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
    const rejection = discoveryRule(policy, absolute, framework);
    const runnable = rejection === null;
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
        testEnvironment: framework === 'vitest' ? policy.config.test?.environment : policy.config.testEnvironment,
        reason: runnable ? 'Selected by the runner test patterns' : rejection + (policy.configFile ? ' in ' + policy.configFile : '') };
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
export function suggestUnitTestTarget(rootDir, sourceFile, framework, preferred, { excluded = new Set(), sameDirectory, newOnly = false } = {}) {
    const root = path.resolve(rootDir);
    const policies = new Map();
    const select = candidate => {
        const file = normalize(path.relative(root, path.resolve(root, normalize(candidate))));
        if (excluded.has(file) || (newOnly && fs.existsSync(path.resolve(root, file))) ||
            (sameDirectory != null && path.posix.dirname(file) !== sameDirectory)) return null;
        return classifyUnitTestPath(root, file, framework, { policies }).writable ? file : null;
    };
    const preferredTarget = preferred && select(preferred);
    if (preferredTarget) return preferredTarget;
    const source = normalize(sourceFile || 'sample.js');
    const absoluteSource = path.resolve(root, source);
    if (!contained(root, absoluteSource)) {
        throw new ServiceError('The source path escapes the workspace.', 422, 'INVALID_TEST_TARGET');
    }
    let policy = runnerPolicy(root, absoluteSource, framework);
    for (let depth = 0; depth < 4; depth++) {
        const projects = framework === 'vitest' ? policy.config.test?.projects : policy.config.projects;
        if (!Array.isArray(projects)) break;
        const configured = projects.filter(entry => entry && typeof entry === 'object').map(config => {
            const setting = config.root || config.rootDir || config.test?.root;
            const directory = typeof setting === 'string'
                ? path.resolve(policy.directory, setting.replaceAll('<rootDir>', policy.directory))
                : null;
            return { config, directory };
        }).filter(project => project.directory && contained(project.directory, absoluteSource))
            .sort((a, b) => b.directory.length - a.directory.length)[0];
        if (!configured) break;
        policy = { ...policy, config: configured.config };
    }
    const config = framework === 'vitest' ? policy.config.test || {} : policy.config;
    const configuredRoot = policy.config.root || config.rootDir || config.root || '.';
    const directory = path.resolve(policy.directory, String(configuredRoot).replaceAll('<rootDir>', policy.directory));
    const ext = path.posix.extname(source) || '.js';
    const base = path.posix.basename(source, ext);
    const sourceBase = contained(directory, absoluteSource) ? directory : policy.directory;
    const relSourceDir = normalize(path.relative(sourceBase, path.dirname(absoluteSource))).replace(/^(?:src|lib)(?:\/|$)/, '');
    const prefixes = relSourceDir && relSourceDir !== '.' ? [relSourceDir + '/', ''] : [''];
    const folders = new Set([...['tests', '__tests__', 'specs', 'test'].map(name => path.join(directory, name)), directory,
        path.join(path.dirname(path.resolve(root, source)), '__tests__')]);
    if (preferred) folders.add(path.dirname(path.resolve(root, normalize(preferred))));
    if (sameDirectory != null) folders.add(path.resolve(root, sameDirectory));
    for (const runnerRoot of Array.isArray(config.roots) ? config.roots : []) {
        if (typeof runnerRoot === 'string') folders.add(path.resolve(directory, runnerRoot.replaceAll('<rootDir>', directory)));
    }
    const endings = new Set([`.test${ext}`, `.spec${ext}`, `.${framework}.test${ext}`]);
    for (const regex of [config.testRegex || []].flat()) {
        if (typeof regex !== 'string') continue;
        const tail = regex.match(/((?:\\\.[\w-]+)+)\\?\$?$/)?.[1];
        if (tail) endings.add(tail.replaceAll('\\', ''));
        for (const match of regex.matchAll(/\/([\w/-]+)\//g)) folders.add(path.resolve(directory, match[1]));
    }
    const options = [];
    for (const prefix of prefixes) {
        for (let pattern of (framework === 'vitest' ? config.include : config.testMatch) || []) {
            if (typeof pattern !== 'string' || /[!?()[\]]/.test(pattern)) continue;
            pattern = normalize(pattern).replaceAll('<rootDir>', normalize(directory));
            pattern = pattern.replace(/\{([^{}]+)\}/g, (_match, choices) => {
                const values = choices.split(',');
                return values.includes('test') ? 'test' : values.includes(ext.slice(1)) ? ext.slice(1) : values[0];
            }).replaceAll('**/', prefix).replaceAll('*', base);
            options.push(path.resolve(directory, pattern));
        }
    }
    for (const folder of folders) {
        for (const prefix of prefixes) {
            for (const ending of endings) options.push(path.resolve(folder, prefix, base + ending));
            if (newOnly) {
                for (const ending of endings) options.push(path.resolve(folder, prefix, base + '.coverage' + ending));
            }
        }
    }
    const resolved = [...new Set(options.map(select).filter(Boolean))];
    const existing = resolved.find(file => fs.existsSync(path.join(root, file)));
    if (existing || resolved[0]) return existing || resolved[0];
    const rejection = preferred && classifyUnitTestPath(root, preferred, framework).reason;
    throw new ServiceError('No writable ' + framework + ' test destination' +
        (rejection ? ': ' + rejection : ' matches ' + (policy.configFile || 'the default suite naming rules')) + '.',
        422, 'INVALID_TEST_TARGET', { filePath: preferred, framework, configFile: policy.configFile, reason: rejection });
}

export function unitTestInventory(rootDir) {
    const root = path.resolve(rootDir);
    const paths = [];
    const metadata = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (ignoredDirectories.has(entry.name) || entry.name.startsWith('.covai') || entry.isSymbolicLink() || isCovaiJestArtifact(entry.name)) continue;
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
