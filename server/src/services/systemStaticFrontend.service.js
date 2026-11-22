import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { containedPath } from './fullSystemConfig.service.js';

const contentTypes = new Map(Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}));

const proxyRequest = (request, response, backend) => {
    const upstream = http.request({
        hostname: backend.hostname,
        port: backend.port,
        path: request.url,
        method: request.method,
        headers: request.headers,
    }, incoming => {
        incoming.on('error', error => {
            console.warn('[systemStaticFrontend] Backend response failed:', error.message);
            response.destroy();
        });
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
    });
    upstream.on('error', error => {
        if (response.destroyed) return;
        console.warn('[systemStaticFrontend] Backend request failed:', error.message);
        if (response.headersSent) response.destroy();
        else response.writeHead(502).end('Backend unavailable');
    });
    request.on('error', error => upstream.destroy(error));
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
};

export const startSystemStaticFrontend = async ({ directory, port, backendUrl }) => {
    const backend = new URL(backendUrl);
    const server = http.createServer((request, response) => {
        const rawPath = request.url.split('?')[0];
        let file;
        try {
            // Inspect the raw path before URL normalization can remove dot segments.
            const pathname = decodeURIComponent(rawPath);
            if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\:\0]/.test(pathname) || pathname.split('/').includes('..')) {
                return response.writeHead(403).end('Forbidden');
            }
            if (rawPath.startsWith('/api/')) return proxyRequest(request, response, backend);
            if (pathname.split('/').some(segment => segment.startsWith('.') || segment.toLowerCase() === 'node_modules')) {
                return response.writeHead(403).end('Forbidden');
            }
            file = containedPath(directory, pathname === '/' ? 'index.html' : pathname.slice(1));
        } catch (error) {
            console.warn('[systemStaticFrontend] Rejected request path:', error.message);
            return response.writeHead(403).end('Forbidden');
        }

        fs.stat(file, (error, stat) => {
            if (response.destroyed) return;
            if (error || !stat.isFile()) return response.writeHead(404).end('Not found');
            response.setHeader('Content-Type', contentTypes.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
            if (request.method === 'HEAD') return response.end();
            const stream = fs.createReadStream(file);
            stream.on('error', readError => {
                console.warn('[systemStaticFrontend] File read failed:', readError.message);
                if (response.headersSent) response.destroy();
                else response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
            });
            response.on('close', () => stream.destroy());
            stream.pipe(response);
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    return {
        port: server.address().port,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
};
