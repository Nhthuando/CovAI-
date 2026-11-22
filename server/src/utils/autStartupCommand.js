import fs from 'node:fs';
import path from 'node:path';

const entryNames = ['server', 'app', 'index', 'src/server', 'src/app', 'src/index']
    .flatMap(name => ['.js', '.mjs', '.cjs'].map(extension => name + extension));

export const inferNodeEntryFile = (packageDir, pkg) => {
    if (['start', 'dev', 'serve', 'preview'].some(name => typeof pkg.scripts?.[name] === 'string')) return null;

    const root = fs.realpathSync(packageDir);
    const candidates = typeof pkg.main === 'string' ? [pkg.main, ...entryNames] : entryNames;
    for (const candidate of candidates) {
        const file = path.resolve(root, candidate);
        const relative = path.relative(root, file);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;

        try {
            const target = path.relative(root, fs.realpathSync(file));
            if (target === '..' || target.startsWith('..' + path.sep) || path.isAbsolute(target)) continue;
            const resolved = path.join(root, target);
            if (fs.statSync(resolved).isFile() && /(?:\.listen|\bcreateServer)\s*\(/.test(fs.readFileSync(resolved, 'utf8'))) {
                return relative.split(path.sep).join('/');
            }
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
                console.warn('[AUT Lifecycle] Could not inspect a Node server entry file:', error.code || error.name);
            }
        }
    }
    return null;
};

// Explicit framework port flags take precedence over package script defaults.
export const autStartupCommand = (scriptName, script, port, {manager='npm',command=manager}={}) => {
    const base = `${command} run ${scriptName}`;
    const separator=manager==='npm'?' --':'';
    if (/\bvite\b/.test(script)) return `${base}${separator} --port ${port} --strictPort --host 127.0.0.1`;
    if (/\bnext\s+(?:dev|start)\b/.test(script)) return `${base}${separator} --port ${port} --hostname 127.0.0.1`;
    if (/\b(?:nuxt|astro)\s+(?:dev|preview)\b/.test(script) || /\bvue-cli-service\s+serve\b/.test(script)) return `${base}${separator} --port ${port} --host 127.0.0.1`;
    if (/\b(?:ng|webpack)\s+serve\b/.test(script) || /\bparcel\b/.test(script)) return `${base}${separator} --port ${port} --host 127.0.0.1`;
    return base;
};
