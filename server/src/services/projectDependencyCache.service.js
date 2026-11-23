import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
        await fs.rm(root, { recursive: true, force: true, maxRetries:15, retryDelay:200 }).catch(() => {});
    }
};
export const canCacheProjectDependencies = plan => plan.manager === 'npm' && plan.installRoot === plan.directory
    && !plan.pkg.workspaces && !Object.keys(plan.pkg.scripts || {}).some(key => /^(?:preinstall|install|postinstall|prepublish|preprepare|prepare|postprepare)$/.test(key))
    && !Object.values({ ...plan.pkg.dependencies, ...plan.pkg.devDependencies, ...plan.pkg.optionalDependencies }).some(value => /^(?:file:|link:|workspace:|\.\.?[\\/])/.test(value));

export const copyDependencyTree = async (source, target, excluded = []) => {
    const excludedPaths = excluded.map(name => path.join(source, name));
    if (process.platform === 'win32') {
        // Windows' native parallel copier avoids serial per-file metadata calls
        // through Node on large dependency trees. Codes 0-7 are success states.
        try {
            await exec('robocopy.exe',[source,target,'/E','/COPY:DAT','/DCOPY:DAT','/R:1','/W:1','/MT:8','/SL','/NFL','/NDL','/NJH','/NJS','/NP',...(excludedPaths.length ? ['/XD',...excludedPaths] : [])],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
            return;
        } catch (error) {
            if (Number.isInteger(error.code) && error.code >= 0 && error.code < 8) return;
            if (error.code !== 'ENOENT') throw new Error('Prepared dependency copy failed');
        }
    }
    await fs.cp(source, target, {
        recursive: true, verbatimSymlinks: true,
        filter: file => !excludedPaths.includes(file),
    });
};

const defaultPersistentRoot = fileURLToPath(new URL('../../.covai-temp/dependency-cache/', import.meta.url));
const lockfileNames = ['package-lock.json', 'npm-shrinkwrap.json'];
const recentUseMs = 10 * 60 * 1000;

export const readDependencyLocks = root => lockfileNames.flatMap(name => {
    try { return [[name, readFileSync(path.join(root, name))]]; }
    catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
});

const realPathWithMissingParents = directory => {
    try { return realpathSync(directory); }
    catch (error) {
        const parent = path.dirname(directory);
        if (error.code !== 'ENOENT' || parent === directory) throw error;
        return path.join(realPathWithMissingParents(parent), path.basename(directory));
    }
};

export const persistentDependencyCacheRoot = repositoryRoot => {
    if (process.env.COVAI_DEPENDENCY_CACHE === 'off') return null;
    const root = realPathWithMissingParents(path.resolve(process.env.COVAI_DEPENDENCY_CACHE_DIR || defaultPersistentRoot));
    const relative = path.relative(realpathSync(repositoryRoot), root);
    if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) return null;
    return root;
};

const warnRemoval = error => console.warn('Could not remove a persistent dependency cache directory.', error);
const removeDirectory = directory => fs.rm(directory, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(warnRemoval);

// Detach the entry before asynchronous cleanup so a writer can publish a
// replacement while the old directory is being removed.
const detachEntry = entry => {
    const detached = `${entry}.tmp-${randomUUID()}`;
    try { renameSync(entry, detached); }
    catch (error) {
        if (error.code !== 'ENOENT') warnRemoval(error);
        return;
    }
    return removeDirectory(detached);
};

const readMetadata = entry => {
    try { return JSON.parse(readFileSync(path.join(entry, 'meta.json'), 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
        throw error;
    }
};

export const readPersistentDependencyEntry = async (root, key) => {
    const entry = path.join(root, key);
    if (!existsSync(entry)) return null;
    const metadata = readMetadata(entry);
    if (!metadata) {
        await detachEntry(entry);
        return null;
    }
    const locks = readDependencyLocks(path.join(entry, 'locks'));
    const updated = path.join(entry, `meta-${randomUUID()}.tmp`);
    try {
        writeFileSync(updated, JSON.stringify({ ...metadata, lastUsedAt:new Date().toISOString() }));
        renameSync(updated, path.join(entry, 'meta.json'));
    } finally {
        try { rmSync(updated, { force:true }); }
        catch (error) { warnRemoval(error); }
    }
    return { directory:path.join(entry, 'node_modules'), locks, entry, createdAt:metadata.createdAt };
};

export const discardPersistentDependencyEntry = async cached => {
    try {
        if (readMetadata(cached.entry)?.createdAt === cached.createdAt) await detachEntry(cached.entry);
    } catch (error) { warnRemoval(error); }
};

const evictPersistentDependencyEntries = async root => {
    const configured = process.env.COVAI_DEPENDENCY_CACHE_MAX_ENTRIES;
    const parsed = Number(configured);
    const limit = configured?.trim() && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 6;
    const removals = [];
    const entries = [];
    for (const name of readdirSync(root)) {
        if (!/^[a-f0-9]{64}$/.test(name)) continue;
        const entry = path.join(root, name);
        const metadata = readMetadata(entry);
        if (!metadata) {
            removals.push(detachEntry(entry));
            continue;
        }
        const timestamp = metadata.lastUsedAt;
        entries.push({ entry, lastUsedAt:(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)) || 0 });
    }
    entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    const cutoff = Date.now() - recentUseMs;
    for (const { entry, lastUsedAt } of entries.slice(limit)) {
        if (lastUsedAt < cutoff) removals.push(detachEntry(entry));
    }
    await Promise.all(removals);
};

export const savePersistentDependencyEntry = async (root, key, modules, locks) => {
    const entry = path.join(root, key);
    if (readMetadata(entry)) {
        await evictPersistentDependencyEntries(root);
        return;
    }
    if (existsSync(entry) && !readMetadata(entry)) await detachEntry(entry);
    const temporary = `${entry}.tmp-${randomUUID()}`;
    try {
        await fs.mkdir(path.join(temporary, 'locks'), { recursive:true });
        const target = path.join(temporary, 'node_modules');
        await copyDependencyTree(modules, target, ['.vite', '.cache', '.prisma']);
        for (const [name, content] of locks) await fs.writeFile(path.join(temporary, 'locks', name), content);
        const files = await fs.readdir(target, { recursive:true, withFileTypes:true });
        const sizeHintFiles = files.filter(file => file.isFile()).length;
        const now = new Date().toISOString();
        await fs.writeFile(path.join(temporary, 'meta.json'), JSON.stringify({ createdAt:now, lastUsedAt:now, sizeHintFiles }));
        try { await fs.rename(temporary, entry); }
        catch (error) {
            if (!readMetadata(entry)) throw error;
        }
    } finally { await removeDirectory(temporary); }
    await evictPersistentDependencyEntries(root);
};
