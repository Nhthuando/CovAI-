import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';

const cache = new Map(), pending = new Map();
let running = 0;

export async function readGitLineBlame({ root, path, content, line }) {
    if (!Number.isSafeInteger(line) || line < 1 || line > 20000) return null;
    const key = JSON.stringify([root,path,line,createHash('sha256').update(content).digest('hex')]);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 2000) return cached.value;
    if (pending.has(key)) return pending.get(key);
    // Bound Git work per API instance; duplicate hovers share a subprocess.
    if (running >= 4) throw Object.assign(new Error('Line history is busy. Try again shortly.'), { statusCode: 503, code: 'LINE_HISTORY_BUSY' });
    running++;
    const task = executeBlame({ root,path,content,line }).then(value => {
        cache.delete(key); cache.set(key,{ at:Date.now(),value });
        while (cache.size > 128) cache.delete(cache.keys().next().value);
        return value;
    }).finally(() => { pending.delete(key); running--; });
    pending.set(key,task);
    return task;
}

async function executeBlame({ root, path, content, line }) {
    if (!Number.isSafeInteger(line) || line < 1 || line > 20000) return null;
    try { const stat = await fs.lstat(nodePath.join(root, '.git')); if (!stat.isDirectory() || stat.isSymbolicLink()) return null; }
    catch { return null; }
    return new Promise(resolve => {
        const child = spawn('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', 'blame', '--no-textconv', '--line-porcelain', '-L', `${line},${line}`, '--contents', '-', '--', path],
            { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
        let output = '', finished = false;
        const done = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { child.kill(); done(null); }, 2500);
        child.stdout.on('data', data => { output += data; if (output.length > 128 * 1024) { child.kill(); done(null); } });
        child.on('error', () => done(null)); child.stdin.on('error', () => {});
        child.on('close', code => {
            if (code) return done(null);
            const commit = output.split(' ')[0];
            if (!/^[a-f0-9]{40,64}$/.test(commit) || /^0+$/.test(commit)) return done(null);
            const field = name => output.split('\n').find(value => value.startsWith(`${name} `))?.slice(name.length + 1);
            done({ commit, author: field('author'), summary: field('summary'), timestamp: new Date(Number(field('author-time')) * 1000).toISOString() });
        });
        child.stdin.end(content);
    });
}
