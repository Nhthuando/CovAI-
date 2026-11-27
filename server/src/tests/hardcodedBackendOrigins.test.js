import { expect, jest, test } from '@jest/globals';
import {
  buildHardcodedBackendForwardingSnippet,
  detectHardcodedBackendOrigins,
  prepareHardcodedBackendForwarding,
} from '../services/hardcodedBackendOrigins.service.js';

test('detects unique HTTP origins and loopback aliases only in frontend source', () => {
  const sourceFiles = [
    { path: 'client/src/App.jsx', content: 'get("http://localhost:5000/api/x"); get(`http://localhost:5000/api/y`);' },
    { path: 'client/src/settings.ts', content: '"http://127.0.0.1:05000/api/z"; "http://localhost:5173/"; "https://localhost:5443/api";' },
    { path: 'client/src/App.test.jsx', content: '"http://localhost:5001/api"' },
    { path: 'client\\tests\\fixture.js', content: '"http://localhost:5002/api"' },
    { path: 'server/src/index.js', content: '"http://localhost:5003/api"' },
    { path: 'backend/index.js', content: '"http://localhost:5004/api"' },
    { path: 'api/index.js', content: '"http://localhost:5005/api"' },
    { path: 'client/node_modules/example/index.js', content: '"http://localhost:5006/api"' },
  ];

  expect(detectHardcodedBackendOrigins({ sourceFiles, frontendPort: 5173 })).toEqual([
    'http://localhost:5000', 'http://127.0.0.1:5000',
  ]);
});

test('logs each detected origin once and excludes HTTPS from forwarding', () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const origins = prepareHardcodedBackendForwarding({
      backendUrl: 'http://127.0.0.1:52579',
      sourceFiles: [{ path: 'App.jsx', content: '"http://localhost:5000/x"; "http://localhost:5000/y"; "https://localhost:5443/x"; "https://localhost:5443/y";' }],
    });

    expect(origins).toEqual(['http://localhost:5000', 'http://127.0.0.1:5000']);
    expect(info.mock.calls).toEqual([['Forwarding hardcoded backend URL http://localhost:5000 → isolated backend']]);
    expect(warn.mock.calls).toEqual([['Hardcoded HTTPS backend URL https://localhost:5443 cannot be forwarded; set an API URL env variable instead.']]);
  } finally {
    info.mockRestore();
    warn.mockRestore();
  }
});

test('generates a route that continues requests to the isolated backend', () => {
  const snippet = buildHardcodedBackendForwardingSnippet({
    origins: ['http://localhost:5000', 'http://127.0.0.1:5000'],
    backendUrl: 'http://127.0.0.1:52579',
  });

  expect(snippet).toContain('["http://localhost:5000","http://127.0.0.1:5000"]');
  expect(snippet).toContain("context.route(origin + '/**', route => route.continue({");
  expect(snippet).toContain('url: route.request().url().replace(origin, "http://127.0.0.1:52579")');
  expect(snippet).not.toContain('fulfill');
});
