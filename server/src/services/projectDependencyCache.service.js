import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const context = new AsyncLocalStorage();
export const currentDependencyCache = () => context.getStore();
export const registerDependencyWorkspace = root => context.getStore()?.workspaces.add(path.resolve(root));
export const isDependencyWorkspace = directory => [...(context.getStore()?.workspaces || [])].some(root => {
    const relative=path.relative(root,path.resolve(directory));
    return relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
});
// Job-local immutable templates, copied into each independent execution. Never
// share live node_modules, generated Prisma clients, databases, or app state.
export const withProjectDependencyCache = async work => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-job-dependencies-'));
    try { return await context.run({ root, entries: new Map(), workspaces:new Set() }, work); }
    finally {
        const relative = path.relative(os.tmpdir(), root);
        if (!relative.startsWith('covai-job-dependencies-') || relative.includes(path.sep)) throw new Error('Invalid dependency cache cleanup path');
        await fs.rm(root, { recursive: true, force: true, maxRetries:10, retryDelay:100 });
    }
};
export const canCacheProjectDependencies = plan => plan.manager === 'npm' && plan.installRoot === plan.directory
    && !plan.pkg.workspaces && !Object.keys(plan.pkg.scripts || {}).some(key => /^(?:preinstall|install|postinstall|prepublish|preprepare|prepare|postprepare)$/.test(key))
    && !Object.values({ ...plan.pkg.dependencies, ...plan.pkg.devDependencies, ...plan.pkg.optionalDependencies }).some(value => /^(?:file:|link:|workspace:|\.\.?[\\/])/.test(value));

export const copyDependencyTree = async (source, target) => {
    if (process.platform === 'win32') {
        // Windows' native parallel copier avoids serial per-file metadata calls
        // through Node on large dependency trees. Codes 0-7 are success states.
        try {
            await exec('robocopy.exe',[source,target,'/E','/COPY:DAT','/DCOPY:DAT','/R:1','/W:1','/MT:8','/SL','/NFL','/NDL','/NJH','/NJS','/NP'],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
            return;
        } catch (error) {
            if (Number.isInteger(error.code) && error.code >= 0 && error.code < 8) return;
            if (error.code !== 'ENOENT') throw new Error('Prepared dependency copy failed');
        }
    }
    await fs.cp(source, target, { recursive: true, verbatimSymlinks: true });
};
