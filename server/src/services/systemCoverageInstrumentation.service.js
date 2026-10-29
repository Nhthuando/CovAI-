import fs from 'node:fs';
import path from 'node:path';
import { createInstrumenter } from 'istanbul-lib-instrument';
import { containedPath } from './fullSystemConfig.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { unknownMeasurement } from './systemAssessmentContract.service.js';

export const prepareSystemCoverage = ({ workspace, coverageScope, measurementId }) => {
    const directory = containedPath(workspace.rootDir, '.covai-system-test/measurement/' + measurementId);
    fs.mkdirSync(directory, { recursive: true });
    const tiers = {};
    for (const tier of ['frontend', 'backend']) {
        const scope = coverageScope[tier];
        if (!scope) { tiers[tier] = { ...unknownMeasurement('NOT_MEASURED', 'TIER_NOT_SELECTED'), zeroMaps: {} }; continue; }
        let root = containedPath(workspace.rootDir, scope.root);
        let prefix = (scope.root === '.' ? '' : scope.root + '/') + (scope.sourceDirectory === '.' ? '' : scope.sourceDirectory + '/');
        if (tier === 'frontend' && scope.root === '.') {
            const hasDirectVite = (() => {
                try {
                    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
                    return Boolean(p.dependencies?.vite || p.devDependencies?.vite);
                } catch { return false; }
            })();
            if (!hasDirectVite) {
                const sub = ['client', 'frontend', 'web', 'ui', 'app'].find(n => {
                    try {
                        const p = JSON.parse(fs.readFileSync(path.join(workspace.rootDir, n, 'package.json'), 'utf8'));
                        return Boolean(p.dependencies?.vite || p.devDependencies?.vite);
                    } catch { return false; }
                });
                if (sub) {
                    root = path.join(workspace.rootDir, sub);
                    prefix = `${sub}/${fs.existsSync(path.join(root, 'src')) ? 'src/' : (scope.sourceDirectory === '.' ? '' : scope.sourceDirectory + '/')}`;
                }
            }
        }
        const inventory = workspace.files.filter(file => file.path.startsWith(prefix) && /\.[cm]?[jt]sx?$/.test(file.path) && !/\.(test|spec|cy|d)\./.test(file.path) && !/(?:^|\/)(?:__tests__|tests?|e2e|fixtures|__mocks__)(?:\/|$)/.test(file.path) && !/(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(file.path));
        const zeroMaps = {}, omittedFiles = [];
        if (tier === 'backend') {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
                if (/\b(?:tsc|tsx|ts-node|babel|webpack|rollup)\b|(?:^|[\s/])(?:dist|build)[/\\]/.test(pkg.scripts?.start || '')) throw new Error();
            } catch { tiers[tier] = { ...unknownMeasurement('UNSUPPORTED', 'BACKEND_REQUIRES_DIRECT_JS_SOURCE_RUNTIME'), zeroMaps: {} }; continue; }
        }
        if (tier === 'frontend') {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
                if (!pkg.dependencies?.vite && !pkg.devDependencies?.vite) throw new Error();
            } catch { tiers[tier] = { ...unknownMeasurement('UNSUPPORTED', 'FRONTEND_REQUIRES_VITE'), zeroMaps: {} }; continue; }
        }
        if (!inventory.length) omittedFiles.push('EMPTY_SOURCE_INVENTORY');
        for (const file of inventory) {
            try {
                if (tier === 'backend' && !/\.[cm]?js$/.test(file.path)) throw new Error('BACKEND_TYPESCRIPT_UNSUPPORTED');
                const source = fs.readFileSync(containedPath(workspace.rootDir, file.path), 'utf8');
                if (/istanbul\s+ignore|new\s+(?:Worker|SharedWorker)\s*\(|serviceWorker\s*\.|['"](?:node:)?(?:worker_threads|child_process)['"]/.test(source)) throw new Error('IGNORED_OR_MULTI_PROCESS_SOURCE_REQUIRES_SEPARATE_ADAPTER');
                const instrumenter = createInstrumenter({ esModules: !/\.cjs$/.test(file.path), parserPlugins: ['jsx', ...( /\.tsx?$/.test(file.path) ? ['typescript'] : [] )], produceSourceMap: true, coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false, preserveComments: true });
                // Instrument the original syntax before Vite strips TS/JSX. Statement locations refer to source, not compiled bundles.
                const code = instrumenter.instrumentSync(source, file.path);
                const map = instrumenter.lastFileCoverage();
                zeroMaps[file.path] = map;
                const sourceMap = instrumenter.lastSourceMap();
                fs.writeFileSync(containedPath(workspace.rootDir, file.path), code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(sourceMap)).toString('base64'), 'utf8');
            } catch (error) { omittedFiles.push({ file: file.path, reason: error.message.slice(0, 200) }); }
        }
        tiers[tier] = { tier, root, inventory: inventory.map(file => file.path), zeroMaps, omittedFiles };
    }
    const manifest = { measurementId, sourceHash: workspace.sourceHash, testHash: workspace.testHash, scopeHash: digest(coverageScope), coverageScope, directory };
    const backendPreload = path.join(directory, 'coverage-preload.cjs');
    fs.writeFileSync(backendPreload, `const fs=require('node:fs');
const file=${JSON.stringify(path.join(directory, 'runtime-backend.json'))};
const identity=${JSON.stringify({ tier: 'backend', measurementId, sourceHash: workspace.sourceHash })};
const http=require('node:http');const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(event,...args){if(event==='request')args[1].setHeader('X-Covai-Measurement-Id',identity.measurementId);return emit.call(this,event,...args);};
function flush(){if(globalThis.__coverage__){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({...identity,coverage:globalThis.__coverage__,activeMutations:[...(globalThis.__covaiMutations || [])]}));fs.renameSync(tmp,file);}}
const timer=setInterval(flush,250);timer.unref();process.on('exit',flush);`, 'utf8');
    return { directory, manifest, tiers, workspace, backendPreload };
};
