import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from '@jest/globals';

describe('external call recorder', () => {
  test('ignores loopback and records DNS failures without request data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-egress-'));
    try {
      const recorder = fileURLToPath(new URL('../utils/externalCallRecorder.cjs', import.meta.url));
      const logPath = path.join(directory, 'egress.jsonl');
      const script = `
        const http = require('node:http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(0, '127.0.0.1', () => {
          http.get('http://127.0.0.1:' + server.address().port, res => {
            res.resume();
            res.once('end', () => {
              server.close();
              http.get('http://example.invalid/private?query=secret', {
                headers: { 'x-secret': 'header secret' },
              }).once('error', error => {
                if (!['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) throw error;
              });
            });
          });
        });
      `;
      const child = spawnSync(process.execPath, ['-r', recorder, '-e', script], {
        env: { ...process.env, COVAI_EGRESS_LOG: logPath },
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
      expect(lines).toEqual([
        { id: expect.any(String), t: expect.any(Number), event: 'start', host: 'example.invalid', method: 'GET' },
        { id: lines[0].id, t: expect.any(Number), event: 'error', code: expect.stringMatching(/^(ENOTFOUND|EAI_AGAIN)$/) },
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 12000);
});
