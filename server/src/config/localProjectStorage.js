import fs from 'node:fs';
import path from 'node:path';

// Local-only disk implementation of the storage operations already used by CovAI.
// The production default remains Firebase; no browser-facing public file route.
export function createLocalProjectBucket(root) {
    if (!root || !path.isAbsolute(root)) throw new Error('PROJECT_STORAGE_ROOT must be an absolute path');
    fs.mkdirSync(root, { recursive: true });
    const base = fs.realpathSync(root);
    const resolve = name => {
        if (!name || name.includes('\\') || path.isAbsolute(name) || name.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid storage path');
        const target = path.resolve(base, name);
        if (!target.startsWith(base + path.sep)) throw new Error('Invalid storage path');
        let cursor = base;
        for (const part of path.relative(base, target).split(path.sep)) {
            cursor = path.join(cursor, part);
            if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symbolic links are not permitted in local storage');
        }
        return target;
    };
    const file = name => {
        const target = resolve(name);
        return {
            name,
            createWriteStream() { fs.mkdirSync(path.dirname(target), { recursive: true }); return fs.createWriteStream(target); },
            createReadStream() { return fs.createReadStream(target); },
            async exists() { return [fs.existsSync(target)]; },
            async download(options) {
                if (options?.destination) { await fs.promises.copyFile(target, options.destination); return []; }
                return [await fs.promises.readFile(target)];
            },
            async save(data) { fs.mkdirSync(path.dirname(target), { recursive: true }); await fs.promises.writeFile(target, data); },
            async delete(options = {}) { await fs.promises.rm(target, { force: Boolean(options.ignoreNotFound) }); },
        };
    };
    return {
        file,
        async getFiles({ prefix = '' } = {}) {
            const files = [];
            async function walk(dir) {
                for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
                    if (entry.isSymbolicLink()) continue;
                    const target = path.join(dir, entry.name);
                    if (entry.isDirectory()) await walk(target);
                    else { const name = path.relative(base, target).replaceAll('\\', '/'); if (name.startsWith(prefix)) files.push(file(name)); }
                }
            }
            await walk(base);
            return [files];
        },
    };
}
