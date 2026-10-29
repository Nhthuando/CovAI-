import http from 'node:http';
import pg from 'pg';
import { isValid } from './valid.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        if (req.url === '/health') { await pool.query('SELECT 1'); res.end('{"ok":true}'); return; }
        if (req.url === '/api/items' && req.method === 'GET') { const result = await pool.query('SELECT name FROM items ORDER BY id'); res.end(JSON.stringify(result.rows)); return; }
        if (req.url === '/api/items' && req.method === 'POST') {
            let body = ''; for await (const chunk of req) body += chunk;
            const { name } = JSON.parse(body);
            if (!isValid(name)) { res.statusCode = 422; res.end('{"error":"Name must not be blank"}'); return; }
            await pool.query('INSERT INTO items(name) VALUES($1)', [name]); res.statusCode = 201; res.end('{"ok":true}'); return;
        }
        res.statusCode = 404; res.end('{}');
    } catch { res.statusCode = 500; res.end('{"error":"Server failure"}'); }
}).listen(Number(process.env.PORT), '127.0.0.1');
