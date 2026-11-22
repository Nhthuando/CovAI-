const logPath = process.env.COVAI_EGRESS_LOG;

if (logPath) {
  const fs = require('node:fs');
  const { randomUUID } = require('node:crypto');
  const http = require('node:http');
  const https = require('node:https');
  const { syncBuiltinESMExports } = require('node:module');
  const { isIP } = require('node:net');
  let warned = false;

  const warn = () => {
    if (warned) return;
    warned = true;
    try {
      fs.writeSync(2, '[externalCallRecorder] Could not record external calls.\n');
    } catch (error) {
      // The application must keep running if stderr is unavailable too.
      return;
    }
  };

  const record = (id, event, fields) => {
    try {
      fs.appendFileSync(logPath, JSON.stringify({ id, t: Date.now(), event, ...fields }) + '\n');
    } catch (error) {
      warn();
    }
  };

  const start = (hostname, method) => {
    const host = hostname?.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host || (!isIP(host) && !/^[a-z0-9_.-]+$/.test(host))) return null;
    if (host === 'localhost' || host === '::1' || host === '0.0.0.0' ||
        (isIP(host) === 4 && host.startsWith('127.')) || host.startsWith('covai-system-')) return null;
    const id = randomUUID();
    record(id, 'start', { host, method });
    return id;
  };

  const recordError = (id, error) => {
    try {
      const code = error?.code || error?.name;
      record(id, 'error', { code: typeof code === 'string' && /^[a-z0-9_]+$/i.test(code) ? code : 'Error' });
    } catch (error) {
      warn();
    }
  };

  const observed = new WeakSet();
  for (const client of [http, https]) {
    for (const method of ['request', 'get']) {
      const original = client[method];
      client[method] = function (...args) {
        const request = Reflect.apply(original, this, args);
        try {
          if (observed.has(request)) return request;
          const id = start(request.host, request.method);
          if (!id) return request;
          observed.add(request);
          // Observing emit preserves unhandled errors and automatic draining of unhandled responses.
          const emit = request.emit;
          request.emit = function (event, ...values) {
            if (event === 'response') record(id, 'end', { status: values[0]?.statusCode });
            if (event === 'error') recordError(id, values[0]);
            return Reflect.apply(emit, this, [event, ...values]);
          };
        } catch (error) {
          warn();
        }
        return request;
      };
    }
  }
  syncBuiltinESMExports();

  if (typeof globalThis.fetch === 'function') {
    const original = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      const promise = Reflect.apply(original, this, arguments);
      try {
        const request = typeof globalThis.Request === 'function' && input instanceof globalThis.Request ? input : null;
        const url = request ? request.url : input;
        if (typeof url !== 'string' && !(url instanceof URL)) return promise;
        const method = Object.getOwnPropertyDescriptor(init ?? {}, 'method')?.value ?? request?.method ?? 'GET';
        const id = start(new URL(url).hostname,
          typeof method === 'string' && /^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(method) ? method.toUpperCase() : 'UNKNOWN');
        if (!id) return promise;
        return promise.then(response => {
          record(id, 'end', { status: response.status });
          return response;
        }, error => {
          recordError(id, error);
          throw error;
        });
      } catch (error) {
        warn();
        return promise;
      }
    };
  }
}
