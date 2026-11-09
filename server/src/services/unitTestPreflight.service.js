import fs from 'node:fs';
import path from 'node:path';
import { extractMissingDependency, inspectWorkspaceDependency, installPackageInWorkspace, isValidNpmPackageName, listWorkspacePackageDirs } from './dependencyResolution.service.js';
import { extractModuleSpecifiers, resolveSpecifierToRelativePath } from './testDependencyResolver.service.js';
import { measureUnitTestPhase, recordUnitTestWork } from './unitTestWork.service.js';
const dependencyBudgetStarts = new WeakMap();

export function collectUnitTestEnvironmentFiles(rootDir, files) {
    const collected = new Set();
    const visit = file => {
        const absolute = path.resolve(rootDir, file);
        const relative = path.relative(rootDir, absolute).replaceAll('\\', '/');
        if (relative.startsWith('..') || path.isAbsolute(relative) || collected.has(relative) || collected.size >= 500 || !fs.existsSync(absolute)) return;
        if (fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile()) return;
        collected.add(relative);
        for (const specifier of extractModuleSpecifiers(fs.readFileSync(absolute, 'utf8'))) {
            const resolved = resolveSpecifierToRelativePath(rootDir, relative, typeof specifier === 'string' ? specifier : specifier.specifier);
            if (!resolved) continue;
            const candidate = [resolved, ...['.js','.ts','.jsx','.tsx','.mjs','.cjs','/index.js','/index.ts'].map(ext => resolved + ext)].find(name => fs.existsSync(path.join(rootDir, name)) && fs.statSync(path.join(rootDir, name)).isFile());
            if (candidate) visit(candidate);
        }
    };
    files.forEach(visit);
    return [...collected];
}

// Shared, bounded resolver for analysis and apply. The caller supplies the isolated
// workspace, never the immutable upload or an origin node_modules junction.
export async function resolveUnitTestDependency({ rootDir, output, attempted = new Set(), jobId = null, maxPackages = 5, install = installPackageInWorkspace }) {
    const dependency = extractMissingDependency(output);
    if (!dependency || !isValidNpmPackageName(dependency.packageName)) return { resolved: false, dependency: null };
    const { packageName } = dependency;
    if (!dependencyBudgetStarts.has(attempted)) dependencyBudgetStarts.set(attempted,Date.now());
    if (Date.now() - dependencyBudgetStarts.get(attempted) >= 5 * 60 * 1000) return {resolved:false,dependency,status:'BLOCKED_DEPENDENCY',reason:'DEPENDENCY_TIME_BUDGET'};
    const specifier = dependency.rawSpecifier || packageName;
    const prefix = specifier.split('/')[0];
    const aliases = ['tsconfig.json','jsconfig.json'].some(file => fs.existsSync(path.join(rootDir,file)) &&
        fs.readFileSync(path.join(rootDir,file),'utf8').includes(`"${prefix}/*"`));
    const internal = listWorkspacePackageDirs(rootDir).some(directory => {
        try { return JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).name === packageName; } catch { return false; }
    });
    if (aliases || internal || /^(?:@\/|~\/|#)/.test(specifier) || fs.existsSync(path.join(rootDir,prefix))) {
        return { resolved: false, dependency, status: 'BLOCKED_DEPENDENCY', reason: internal ? 'WORKSPACE_PACKAGE_UNRESOLVED' : 'INTERNAL_ALIAS_UNRESOLVED' };
    }
    if (attempted.has(packageName) || attempted.size >= maxPackages) return { resolved: false, dependency, status: 'BLOCKED_DEPENDENCY', reason: 'DEPENDENCY_RETRY_LIMIT' };
    const inspection = inspectWorkspaceDependency({ rootDir, ...dependency });
    const packageRelative = path.relative(path.resolve(rootDir),path.resolve(inspection.targetDir));
    if (packageRelative.startsWith('..') || path.isAbsolute(packageRelative)) return {resolved:false,dependency,status:'BLOCKED_DEPENDENCY',reason:'WORKSPACE_MANIFEST_REQUIRED'};
    // Do not let npm install through an inherited node_modules junction into the origin.
    for (const directory of new Set([rootDir, inspection.targetDir])) {
        const modules = path.join(directory, 'node_modules');
        if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) fs.unlinkSync(modules);
        else if (fs.existsSync(modules)) {
            for (const entry of fs.readdirSync(modules,{withFileTypes:true})) {
                const target = path.join(modules,entry.name);
                if (entry.isSymbolicLink()) fs.unlinkSync(target);
                else if (entry.name.startsWith('@') && entry.isDirectory()) {
                    for (const child of fs.readdirSync(target,{withFileTypes:true})) if (child.isSymbolicLink()) fs.unlinkSync(path.join(target,child.name));
                }
            }
        }
    }
    attempted.add(packageName);
    recordUnitTestWork('dependencyInstalls');
    const result = await measureUnitTestPhase('dependencyInstall', () => install({ rootDir, ...dependency,
        isDev: /(?:tests?\/|__tests__|\.(test|spec|steps?)\.)/.test(dependency.importedFrom || ''), jobId }));
    return { resolved: result?.success === true, dependency, status: result?.success ? 'DEPENDENCY_INSTALLED' : 'BLOCKED_DEPENDENCY', reason: result?.success ? null : 'DEPENDENCY_INSTALL_FAILED' };
}
