// Executed by the orchestrator inside the sandbox. stdin carries a bounded JSON request.
import http from 'node:http';
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('REQUEST_TOO_LARGE'); }
const data = JSON.parse(input);
if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || typeof data.path !== 'string' || !data.path.startsWith('/') || data.path.startsWith('//')) throw new Error('INVALID_LOCAL_TARGET');
const payload = JSON.stringify(data.body);
if (data.method && !['GET', 'POST'].includes(data.method)) throw new Error('INVALID_LOCAL_METHOD');
const result = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: data.port, path: data.path, method: data.method || 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.method === 'GET' ? 0 : Buffer.byteLength(payload) }, timeout: Math.min(data.timeoutMs || 60000, 120000) }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error('RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('RESPONSE_ABORTED')));
        response.on('end', () => resolve({ status: response.statusCode, contentType: response.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('REQUEST_TIMEOUT'))); request.on('error', reject); request.end(data.method === 'GET' ? undefined : payload);
}).catch(error => ({ transportError: error.code === 'ECONNREFUSED' ? 'LOCAL_CONNECTION_REFUSED' : 'LOCAL_REQUEST_FAILED', dispatched: error.code !== 'ECONNREFUSED' }));
process.stdout.write(JSON.stringify(result));
