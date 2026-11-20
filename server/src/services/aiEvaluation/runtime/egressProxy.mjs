// Trusted sandbox sidecar. No project code or COVAI credentials are loaded here.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
const allowed = new Set(['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.anthropic.com', 'api.groq.com']);
const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix);
const server = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
server.on('connect', async (request, client, head) => {
    client.on('error', () => {});
    const match = /^([a-z0-9.-]+):443$/i.exec(request.url || '');
    if (!match || !allowed.has(match[1].toLowerCase())) return client.destroy();
    try {
        const addresses = await dns.lookup(match[1], { all: true, family: 4 });
        if (!addresses.length || addresses.some(a => blocked.check(a.address))) return client.destroy();
        const upstream = net.connect({ host: addresses[0].address, port: 443 });
        let bytes = 0;
        const limit = chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) { upstream.destroy(); client.destroy(); } };
        upstream.setTimeout(120000, () => upstream.destroy());
        client.setTimeout(120000, () => client.destroy());
        upstream.on('error', () => client.destroy()); client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
        client.on('data', limit); upstream.on('data', limit);
        upstream.on('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    } catch { client.destroy(); }
});
server.listen(3128, '0.0.0.0');
setTimeout(() => process.exit(0), 30 * 60 * 1000);
