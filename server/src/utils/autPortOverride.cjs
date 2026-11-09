// Loaded only for the isolated Full Stack backend. Preserve the imported source
// while adapting HTTP servers that hard-code their listening port and preventing
// dotenv({ override: true }) from overwriting isolated database/port resources.
const http = require('node:http');
const Module = require('node:module');
const lockedEntries = Object.entries(process.env).filter(([key, value]) =>
    value !== undefined && /^(?:COVAI_|PORT$|SERVER_PORT$|HTTP_PORT$|API_PORT$|BACKEND_PORT$|DATABASE_|DB_|MYSQL_|PG|POSTGRES|TYPEORM_|MONGO|SQLITE_|REDIS_|CACHE_URL$|CLIENT_URL$|FRONTEND_URL$|CORS_ORIGIN$)/.test(key)
);
const restoreLockedEnv = () => {
    for (const [key, value] of lockedEntries) process.env[key] = value;
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (request === 'dotenv' || request === 'dotenv/config' || /[\\/]dotenv(?:[\\/]|$)/.test(String(request))) {
        restoreLockedEnv();
        if (loaded && typeof loaded === 'object') {
            for (const fn of ['config', 'populate']) {
                if (typeof loaded[fn] === 'function' && !loaded[fn].__covaiWrapped) {
                    const orig = loaded[fn];
                    const wrapped = function (...args) {
                        const res = orig.apply(this, args);
                        restoreLockedEnv();
                        return res;
                    };
                    wrapped.__covaiWrapped = true;
                    try { loaded[fn] = wrapped; } catch {}
                }
            }
        }
    }
    return loaded;
};
const port = Number(process.env.COVAI_AUT_PORT);
if (Number.isInteger(port) && port > 0 && port <= 65535) {
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
        restoreLockedEnv();
        if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) args[0] = port;
        else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) args[0] = {...args[0],port};
        return listen.apply(this,args);
    };
}
