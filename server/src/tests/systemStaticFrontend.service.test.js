import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect } from '@jest/globals';
import { startSystemStaticFrontend } from '../services/systemStaticFrontend.service.js';

const send = (port, pathname, options, body) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, ...options }, response => {
        let content = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { content += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, content }));
        response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
});

const withFrontend = async (run, backendUrl = 'http://127.0.0.1:1') => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-static-'));
    const directory = path.join(root, 'frontend');
    let frontend;
    try {
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'index.html'), '<title>FAQ</title>');
        fs.writeFileSync(path.join(directory, 'style.css'), 'body { margin: 0; }');
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        frontend = await startSystemStaticFrontend({ directory, port: 0, backendUrl });
        await run(frontend.port);
    } finally {
        try { await frontend?.close(); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
};

describe('static Full Stack frontend', () => {
    test('serves index.html at the root', () => withFrontend(async port => {
        const result = await send(port, '/');
        expect(result).toMatchObject({ status: 200, content: '<title>FAQ</title>' });
        expect(result.headers['content-type']).toMatch(/^text\/html/);
    }));

    test('serves CSS with its content type and returns 404 for a missing file', () => withFrontend(async port => {
        const result = await send(port, '/style.css?v=1');
        expect(result).toMatchObject({ status: 200, content: 'body { margin: 0; }' });
        expect(result.headers['content-type']).toMatch(/^text\/css/);
        expect((await send(port, '/missing.css')).status).toBe(404);
    }));

    test('rejects raw and encoded parent directory traversal', () => withFrontend(async port => {
        expect((await send(port, '/../package.json')).status).toBe(403);
        expect((await send(port, '/%2e%2e/package.json')).status).toBe(403);
    }));

    test.each(['/.env', '/node_modules/x.js'])('forbids static requests to %s', pathname => withFrontend(async port => {
        expect((await send(port, pathname)).status).toBe(403);
    }));

    test('proxies the method, headers, query and body to the backend', async () => {
        const backend = http.createServer((request, response) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => { body += chunk; });
            request.on('end', () => response.writeHead(201, { 'x-backend': 'dummy' }).end(
                JSON.stringify({ method: request.method, url: request.url, header: request.headers['x-test'], body }),
            ));
        });
        await new Promise((resolve, reject) => {
            backend.once('error', reject);
            backend.listen(0, '127.0.0.1', resolve);
        });
        try {
            await withFrontend(async port => {
                const result = await send(port, '/api/x?q=1', { method: 'POST', headers: { 'x-test': 'value' } }, 'payload');
                expect(result.status).toBe(201);
                expect(result.headers['x-backend']).toBe('dummy');
                expect(JSON.parse(result.content)).toEqual({ method: 'POST', url: '/api/x?q=1', header: 'value', body: 'payload' });
            }, `http://127.0.0.1:${backend.address().port}`);
        } finally {
            await new Promise((resolve, reject) => backend.close(error => error ? reject(error) : resolve()));
        }
    });
});
