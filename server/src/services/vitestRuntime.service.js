import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { installPackageInWorkspace } from './dependencyResolution.service.js';
import { ServiceError } from '../utils/serviceError.js';

const read = file => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return null; } };
const contained = (root,file) => {const rel=path.relative(path.resolve(root),path.resolve(file));return !rel.startsWith('..') && !path.isAbsolute(rel);};
function localPackage(root,directory,name) {
    let current=path.resolve(directory);
    while(contained(root,current)) {
        const logical=path.join(current,'node_modules',name,'package.json');
        const pkg=read(logical);
        if(pkg && semver.valid(pkg.version)) return {version:pkg.version,logical,real:fs.realpathSync(logical),manifest:pkg};
        if(current === path.resolve(root)) break;
        const parent=path.dirname(current);if(parent === current)break;current=parent;
    }
    return null;
}

/** Resolve packages from the execution workspace, never .bin shims, NODE_PATH
 * globals or an unrelated operation's parent runtime. */
export function inspectVitestCoverageRuntime(rootDir,executionDir=rootDir) {
    const runner=localPackage(rootDir,executionDir,'vitest');
    const provider=localPackage(rootDir,executionDir,'@vitest/coverage-v8');
    let providerRunner=null;
    if(provider) {
        // Follow Node's ancestor lookup from the provider's real location using
        // fresh filesystem reads. require.resolve can cache old symlink targets
        // after an installer repairs an operation's borrowed dependency tree.
        let directory=path.dirname(provider.real);
        while(true) {
            const candidate=path.join(directory,'node_modules/vitest/package.json');
            const pkg=read(candidate);
            if(pkg) {providerRunner={real:fs.realpathSync(candidate),version:pkg.version};break;}
            const parent=path.dirname(directory);if(parent === directory)break;directory=parent;
        }
    }
    const project=read(path.join(executionDir,'package.json')) || read(path.join(rootDir,'package.json')) || {};
    const declared=project.devDependencies?.vitest || project.dependencies?.vitest;
    const matchesDeclaration=!declared || !semver.validRange(declared) || (runner && semver.satisfies(runner.version,declared,{includePrerelease:true}));
    const entry=runner && path.join(path.dirname(runner.logical),'vitest.mjs');
    const compatible=Boolean(runner && provider && fs.existsSync(entry) && matchesDeclaration && runner.version === provider.version &&
        providerRunner?.version === runner.version && providerRunner.real === runner.real);
    return {runner,provider,providerRunner,declared,matchesDeclaration,entry,compatible};
}

export async function ensureVitestCoverageRuntime({rootDir,executionDir=rootDir,jobId=null,install=installPackageInWorkspace}) {
    if(!contained(rootDir,executionDir))throw new ServiceError('Vitest execution must remain inside its workspace',400);
    let state=inspectVitestCoverageRuntime(rootDir,executionDir);
    const target=path.relative(rootDir,path.join(executionDir,'package.json')).replaceAll('\\','/');
    if(!state.runner || !state.matchesDeclaration) {
        const fallback=read(fileURLToPath(new URL('../../node_modules/vitest/package.json',import.meta.url)))?.version;
        const result=await install({rootDir,packageName:'vitest',isDev:true,importedFrom:target,jobId,
            ...(!state.declared && semver.valid(fallback) ? {version:fallback} : {})});
        if(!result.success)throw new ServiceError(`Unable to restore the project's Vitest runtime. ${result.stderr || ''}`,409);
        state=inspectVitestCoverageRuntime(rootDir,executionDir);
    }
    if(!state.runner || !state.matchesDeclaration)throw new ServiceError('The installed Vitest runtime does not match the project declaration.',409);
    if(!state.compatible) {
        const result=await install({rootDir,packageName:'@vitest/coverage-v8',version:state.runner.version,isDev:true,importedFrom:target,jobId});
        if(!result.success)throw new ServiceError(`Unable to align @vitest/coverage-v8 with Vitest ${state.runner.version}. ${result.stderr || ''}`,409);
        state=inspectVitestCoverageRuntime(rootDir,executionDir);
    }
    if(!state.compatible)throw new ServiceError(`Vitest coverage runtime is incompatible: runner=${state.runner?.version || 'missing'}, provider=${state.provider?.version || 'missing'}, provider's runner=${state.providerRunner?.version || 'missing'}. All packages must resolve the same runtime tree. Coverage and Apply were stopped.`,409,'VITEST_COVERAGE_RUNTIME_MISMATCH');
    const relative=path.relative(executionDir,state.entry).replaceAll('\\','/');
    return {...state,command:`node "${relative}"`,major:semver.major(state.runner.version)};
}

/** Preserve configured flags while binding execution to the verified runtime. */
export function bindVitestCommand(directory,command,runtimeCommand) {
    let text=String(command || 'vitest run').trim();
    const script=text.match(/^(?:npm\s+(?:run\s+)?|pnpm\s+(?:run\s+)?|yarn\s+(?:run\s+)?)([\w:-]+)(?:\s+--)?(.*)$/);
    if(script) {
        const value=read(path.join(directory,'package.json'))?.scripts?.[script[1]];
        if(!value)throw new ServiceError('The configured Vitest script could not be resolved in its package.',409);
        text=`${value.trim()} ${script[2].trim()}`.trim();
    }
    if(/[;&`]|\|\|/.test(text))throw new ServiceError('A chained Vitest script cannot be verified. Use a single vitest run command with explicit flags.',409);
    const match=text.match(/^(?:npx\s+(?:(?:--yes|--no-install)\s+)?vitest|(?:[.\/\\\w:-]*node_modules[\/\\]\.bin[\/\\])?vitest(?:\.cmd)?|node\s+(?:"[^"]*vitest(?:[\/\\]vitest)?\.mjs"|'[^']*vitest(?:[\/\\]vitest)?\.mjs'|\S*vitest(?:[\/\\]vitest)?\.mjs))(?=\s|$)/);
    if(!match)throw new ServiceError('The custom Vitest command cannot be bound to a verified runtime. Use a vitest run script with explicit flags.',409);
    const args=text.slice(match[0].length).trim().replace(/^run(?:\s+|$)/,'');
    return `${runtimeCommand} run${args ? ` ${args}` : ''}`;
}
