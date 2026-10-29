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
