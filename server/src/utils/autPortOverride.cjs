// Loaded only for the isolated Full Stack backend. Preserve the imported source
// while adapting HTTP servers that hard-code their listening port.
const http = require('node:http');
const Module = require('node:module');
const port = Number(process.env.COVAI_AUT_PORT);
if (Number.isInteger(port) && port > 0 && port <= 65535) {
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
        if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) args[0] = port;
        else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) args[0] = {...args[0],port};
        return listen.apply(this,args);
    };
}

const sqliteFallbackPath = process.env.COVAI_SQLITE_FALLBACK_PATH;
if (sqliteFallbackPath) {
    let dbInstance = null;
    const getDb = () => {
        if (!dbInstance) {
            const { DatabaseSync } = require('node:sqlite');
            dbInstance = new DatabaseSync(sqliteFallbackPath);
        }
        return dbInstance;
    };
    const normalizeParams = (params = []) => (Array.isArray(params) ? params : [params]).map((val) => {
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (val instanceof Date) return val.toISOString();
        if (val === undefined) return null;
        return val;
    });
    const runMysqlQuery = (rawSql, rawParams) => {
        const db = getDb();
        const sql = String(rawSql || '').trim().replace(/`/g, '"');
        const params = normalizeParams(rawParams);
        const stmt = db.prepare(sql);
        if (/^(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
            const rows = stmt.all(...params);
            return [rows, []];
        }
        const info = stmt.run(...params);
        return [{ insertId: Number(info.lastInsertRowid || 0), affectedRows: Number(info.changes || 0), changedRows: Number(info.changes || 0) }, []];
    };
    const createMysqlShim = (isPromiseModule) => {
        const promiseClient = {
            query: async (sql, params) => runMysqlQuery(sql, params),
            execute: async (sql, params) => runMysqlQuery(sql, params),
            getConnection: async () => ({
                ...promiseClient,
                release: () => {},
                beginTransaction: async () => {},
                commit: async () => {},
                rollback: async () => {},
            }),
            connect: async () => {},
            end: async () => {},
            release: () => {},
        };
        const callbackClient = {
            query: (sql, params, cb) => {
                const callback = typeof params === 'function' ? params : cb;
                const bindParams = typeof params === 'function' ? [] : params;
                if (typeof callback === 'function') {
                    Promise.resolve().then(() => runMysqlQuery(sql, bindParams)).then(([rows, fields]) => callback(null, rows, fields), (err) => callback(err));
                    return callbackClient;
                }
                return Promise.resolve().then(() => runMysqlQuery(sql, bindParams));
            },
            execute: (sql, params, cb) => callbackClient.query(sql, params, cb),
            getConnection: (cb) => {
                if (typeof cb === 'function') {
                    Promise.resolve().then(() => cb(null, { ...callbackClient, release: () => {} }));
                    return;
                }
                return promiseClient.getConnection();
            },
            connect: (cb) => { if (typeof cb === 'function') Promise.resolve().then(() => cb(null)); return Promise.resolve(); },
            end: (cb) => { if (typeof cb === 'function') Promise.resolve().then(() => cb(null)); return Promise.resolve(); },
            promise: () => promiseClient,
            on: () => callbackClient,
        };
        const makeClient = () => (isPromiseModule ? Promise.resolve(promiseClient) : callbackClient);
        const makePool = () => (isPromiseModule ? promiseClient : callbackClient);
        return {
            createPool: makePool,
            createConnection: makeClient,
            promise: () => createMysqlShim(true),
        };
    };
    const createPgShim = () => {
        const runPgQuery = async (sqlOrConfig, rawValues) => {
            const rawSql = typeof sqlOrConfig === 'object' && sqlOrConfig !== null ? sqlOrConfig.text : sqlOrConfig;
            const values = typeof sqlOrConfig === 'object' && sqlOrConfig !== null ? (sqlOrConfig.values || rawValues || []) : (rawValues || []);
            const boundParams = [];
            const sqliteSql = String(rawSql || '').replace(/\$(\d+)/g, (_, idx) => {
                boundParams.push(values[Number(idx) - 1]);
                return '?';
            });
            const [result] = runMysqlQuery(sqliteSql, boundParams);
            if (Array.isArray(result)) {
                return { rows: result, rowCount: result.length };
            }
            return { rows: [], rowCount: Number(result?.affectedRows || 0) };
        };
        class PgClientShim {
            async connect() { return this; }
            query(sql, values, cb) {
                const callback = typeof values === 'function' ? values : cb;
                const params = typeof values === 'function' ? [] : values;
                const promise = runPgQuery(sql, params);
                if (typeof callback === 'function') {
                    promise.then((res) => callback(null, res), (err) => callback(err));
                    return;
                }
                return promise;
            }
            release() {}
            async end() {}
            on() { return this; }
        }
        return { Pool: PgClientShim, Client: PgClientShim, default: { Pool: PgClientShim, Client: PgClientShim } };
    };
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'mysql2/promise') return createMysqlShim(true);
        if (request === 'mysql2' || request === 'mysql') return createMysqlShim(false);
        if (request === 'pg') return createPgShim();
        return origLoad.apply(this, arguments);
    };
}
